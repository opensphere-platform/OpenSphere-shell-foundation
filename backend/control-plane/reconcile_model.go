// reconcile_model.go — FoundationModel reconcile: 모델별 번들 레지스트리(bundles)로 선언형 배포/회수 + status.observed(정직).
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var depGVK = schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}

// directApplyAllowed — ADR-FND-006 §2.2 fleet 모드 게이트.
// env FOUNDATION_DIRECT_APPLY="true"|"1"(대소문자·공백 무시)일 때만 true(기본 false).
// 패턴: Jupiter 리뷰 ③ FLEET_COMPLIANCE_ADMIN_FALLBACK과 동일.
func directApplyAllowed() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("FOUNDATION_DIRECT_APPLY")))
	return v == "true" || v == "1"
}

type modelReconciler struct {
	cached client.Client // Foundation CR(클러스터 RBAC) — 캐시 경유
	direct client.Client // 관리 번들(네임스페이스 Role) — 캐시 비경유
	cfg    *config
}

func (r *modelReconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	log := ctrl.LoggerFrom(ctx)
	fm := gvkObj(fmGVK)
	if err := r.cached.Get(ctx, req.NamespacedName, fm); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	model, _, _ := unstructured.NestedString(fm.Object, "spec", "model")
	desired, _, _ := unstructured.NestedString(fm.Object, "spec", "desiredState")

	// 실 번들 보유 모델만 배포(D-1 observability·D-3 identity). 나머지는 정직하게 "대기".
	b, ok := bundles[model]
	if !ok {
		return r.setPending(ctx, fm, desired)
	}
	if desired == "Installed" {
		res, err := r.install(ctx, fm, b)
		if err != nil {
			log.Error(err, "install 실패", "model", model)
		}
		return res, err
	}
	return r.withdraw(ctx, fm, b)
}

func (r *modelReconciler) setPending(ctx context.Context, fm *unstructured.Unstructured, desired string) (reconcile.Result, error) {
	phase := "Disabled"
	if desired == "Installed" {
		phase = "Installing"
	}
	err := updateStatusRetry(ctx, r.direct, fmGVK, types.NamespacedName{Name: fm.GetName()}, func(o *unstructured.Unstructured) {
		setNested(o, phase, "status", "phase")
		setNested(o, false, "status", "operator", "deployed")
		setNested(o, "reconcile: bundle pending", "status", "controlPlane")
		setNested(o, "bundle 미구현(D-2·D-4~D-6 — 정직 표기)", "status", "note")
		_ = unstructured.SetNestedSlice(o.Object, []interface{}{}, "status", "observed")
		// observedAt는 측정 시각을 함의하므로 미측정(bundle 대기) 모델엔 기록하지 않는다(정직).
	})
	return reconcile.Result{}, err
}

func (r *modelReconciler) install(ctx context.Context, fm *unstructured.Unstructured, b bundleSpec) (reconcile.Result, error) {
	log := ctrl.LoggerFrom(ctx)
	model := fm.GetName()

	// ADR-FND-006 §2.2 fleet 모드 게이트: FOUNDATION_DIRECT_APPLY가 활성화되지 않으면 operand 직접 SSA 차단.
	if !directApplyAllowed() {
		blockedMsg := "fleet mode: operand 직접 SSA 차단(ADR-FND-006) — GitOps render 경로 필요. break-glass: FOUNDATION_DIRECT_APPLY=true"
		err := updateStatusRetry(ctx, r.direct, fmGVK, types.NamespacedName{Name: model}, func(o *unstructured.Unstructured) {
			setNested(o, "Blocked", "status", "phase")
			setNested(o, false, "status", "operator", "deployed")
			setNested(o, "reconcile("+b.slice+")", "status", "controlPlane")
			setNested(o, blockedMsg, "status", "note")
		})
		if err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
	}

	// FOUNDATION_DIRECT_APPLY=true: audit log 출력 후 기존 경로 진행.
	log.Info("direct-apply(SSA) operand 배포 — FOUNDATION_DIRECT_APPLY 활성(local-dev/standalone topology)", "model", model)

	// 1) 설치 ns 보장 + 번들 SSA(선언형) — fm status 쓰기 없음(부수효과만). 설치 NS는 모델별(data=설치옵션 namespace).
	ns := r.cfg.managedNS
	if b.nsOf != nil {
		ns = b.nsOf(r.cfg, fm)
	}
	if err := applyObj(ctx, r.direct, ensureNamespace(ns)); err != nil {
		return reconcile.Result{}, fmt.Errorf("ns ensure: %w", err)
	}
	objs, err := b.build(r.cfg, fm)
	if err != nil {
		return reconcile.Result{}, err
	}
	for _, o := range objs {
		if err := applyObj(ctx, r.direct, o); err != nil {
			// HostDelegate 계약 오브젝트(§3.3): Basic Prometheus Operator 미설치 클러스터에서도
			// 나머지 operand(Deployment/Service 등)는 정상 배포되도록 CRD 부재는 non-fatal degrade.
			if o.GetKind() == "ServiceMonitor" && meta.IsNoMatchError(err) {
				log.Info("ServiceMonitor CRD 없음 — Basic Prometheus Operator 미설치로 판단, 관측 연결 위임 skip(non-fatal)", "name", o.GetName())
				continue
			}
			return reconcile.Result{}, fmt.Errorf("apply %s/%s: %w", o.GetKind(), o.GetName(), err)
		}
	}
	// 엔진 단위 회수(2026-07-06): engines 설치옵션으로 disabled된 엔진은 build 필터로 '앞으로 안 깔릴'뿐
	// 아니라 '이미 깔린' operand도 lblEngine 셀렉터로 회수한다(Disable=실회수 — "메뉴=실재의 투영").
	// PVC는 bundleKinds에 없어 보존(AD SAM DB 등 데이터). DeleteAllOf는 멱등.
	for _, e := range b.engines {
		if engineEnabled(fm, e) {
			continue
		}
		sel := client.MatchingLabels{lblManagedBy: cpManagedBy, lblOwnerFM: fm.GetName(), lblEngine: e}
		for _, gvk := range bundleKinds() {
			o := gvkObj(gvk)
			if err := r.direct.DeleteAllOf(ctx, o, client.InNamespace(ns), sel); err != nil && !apierrors.IsNotFound(err) && !meta.IsNoMatchError(err) {
				return reconcile.Result{}, fmt.Errorf("engine 회수 %s(%s): %w", e, gvk.Kind, err)
			}
		}
	}
	// 2) 준비도(정직: Deployment readyReplicas, 또는 CR-기반 오버라이드) + status.observed(실 신호) — 단일 status 쓰기
	ready := r.deploymentReady(ctx, b.deployName)
	if b.ready != nil {
		ready = b.ready(ctx, r, fm) // CNPG Cluster 등 비-Deployment operand(설치 NS)
	}
	observed, sample := b.observe(ctx, r, fm, ready)
	err = updateStatusRetry(ctx, r.direct, fmGVK, types.NamespacedName{Name: fm.GetName()}, func(o *unstructured.Unstructured) {
		setNested(o, "reconcile("+b.slice+")", "status", "controlPlane")
		setNested(o, "", "status", "note")
		_ = unstructured.SetNestedSlice(o.Object, observed, "status", "observed")
		if sample != nil {
			_ = unstructured.SetNestedMap(o.Object, sample, "status", "observedSamples")
		}
		setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "observedAt")
		if ready {
			setNested(o, "Installed", "status", "phase")
			setNested(o, true, "status", "operator", "deployed")
			setNested(o, imageTag(b.image(r.cfg)), "status", "operator", "version")
			if b.extra != nil {
				b.extra(r.cfg, o) // 모델별 추가 status(예: identity issuerURL)
			}
		} else {
			setNested(o, "Installing", "status", "phase")
			setNested(o, false, "status", "operator", "deployed")
		}
	})
	if err != nil {
		return reconcile.Result{}, err
	}
	if !ready {
		return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
	}
	return reconcile.Result{RequeueAfter: 30 * time.Second}, nil // 설치 후 주기적 메트릭 갱신
}

func (r *modelReconciler) withdraw(ctx context.Context, fm *unstructured.Unstructured, b bundleSpec) (reconcile.Result, error) {
	ns := r.cfg.managedNS
	if b.nsOf != nil {
		ns = b.nsOf(r.cfg, fm)
	}
	// ADR-FND-006 §3.3: 회수 셀렉터는 3종 라벨 모두 일치해야 함(SSA 소유 객체만 안전 회수).
	sel := client.MatchingLabels{lblManagedBy: cpManagedBy, lblOwnerFM: fm.GetName(), lblDeliveryEngine: "ssa"}
	for _, gvk := range bundleKinds() {
		o := gvkObj(gvk)
		if err := r.direct.DeleteAllOf(ctx, o, client.InNamespace(ns), sel); err != nil && !apierrors.IsNotFound(err) {
			return reconcile.Result{}, fmt.Errorf("회수 %s: %w", gvk.Kind, err)
		}
	}
	// 삭제 확인(Deployment gone) → Disabled, 아니면 Removing. 공유 ns는 보존. 단일 status 쓰기.
	dep := gvkObj(depGVK)
	gerr := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: b.deployName}, dep)
	if gerr != nil && !apierrors.IsNotFound(gerr) {
		return reconcile.Result{}, gerr
	}
	gone := apierrors.IsNotFound(gerr)
	if b.gone != nil {
		gone = b.gone(ctx, r, fm) // CNPG Cluster 등 비-Deployment operand의 소멸 판정(설치 NS)
	}
	err := updateStatusRetry(ctx, r.direct, fmGVK, types.NamespacedName{Name: fm.GetName()}, func(o *unstructured.Unstructured) {
		setNested(o, "reconcile("+b.slice+")", "status", "controlPlane")
		if gone {
			setNested(o, "Disabled", "status", "phase")
			setNested(o, false, "status", "operator", "deployed")
			_ = unstructured.SetNestedSlice(o.Object, []interface{}{}, "status", "observed")
			// 재설치 시 stale 샘플로 잘못된 rate가 나오지 않게 샘플도 제거(clean baseline).
			unstructured.RemoveNestedField(o.Object, "status", "observedSamples")
			unstructured.RemoveNestedField(o.Object, "status", "issuerURL")
			unstructured.RemoveNestedField(o.Object, "status", "jwksURL")
		} else {
			setNested(o, "Removing", "status", "phase")
		}
	})
	if err != nil {
		return reconcile.Result{}, err
	}
	if !gone {
		return reconcile.Result{RequeueAfter: 5 * time.Second}, nil
	}
	return reconcile.Result{}, nil
}

func (r *modelReconciler) deploymentReady(ctx context.Context, name string) bool {
	dep := gvkObj(depGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: name}, dep); err != nil {
		return false
	}
	rr, _, _ := unstructured.NestedInt64(dep.Object, "status", "readyReplicas")
	gen, _, _ := unstructured.NestedInt64(dep.Object, "metadata", "generation")
	og, _, _ := unstructured.NestedInt64(dep.Object, "status", "observedGeneration")
	return rr >= 1 && og >= gen
}

func readSample(fm *unstructured.Unstructured) (float64, time.Time, bool) {
	s, found, _ := unstructured.NestedString(fm.Object, "status", "observedSamples", "acceptedSpans")
	tsStr, _, _ := unstructured.NestedString(fm.Object, "status", "observedSamples", "ts")
	if !found || tsStr == "" {
		return 0, time.Time{}, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, time.Time{}, false
	}
	ts, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		return 0, time.Time{}, false
	}
	return v, ts, true
}

func bundleKinds() []schema.GroupVersionKind {
	return []schema.GroupVersionKind{
		depGVK,
		{Group: "", Version: "v1", Kind: "Service"},
		{Group: "", Version: "v1", Kind: "ConfigMap"},
		{Group: "", Version: "v1", Kind: "ServiceAccount"},
		{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"},
		cnpgClusterGVK, // data hybrid-wrap: CloudNativePG Cluster CR(라벨 회수)
		cnpgPoolerGVK,  // data: PgBouncer Pooler CR(라벨 회수)
	}
}
