// reconcile_claim.go — FoundationClaim reconcile: FoundationBinding 발급 + 연결담보 finalizer + release(P6).
// 신뢰경계: 사용자는 의도(Claim)만 쓴다. Binding(보증 객체)은 control plane이 소유·발행한다.
// 모든 status/finalizer 쓰기는 신선한 Get + conflict 재시도(updateStatusRetry/updateMetaRetry)로 stale RV 회피.
package main

import (
	"context"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

type claimReconciler struct {
	cached client.Client // watch source(Get)
	direct client.Client // status/finalizer/binding 쓰기(신선 RV)
	cfg    *config
}

func (r *claimReconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	log := ctrl.LoggerFrom(ctx)
	fc := gvkObj(fcGVK)
	if err := r.cached.Get(ctx, req.NamespacedName, fc); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	nn := types.NamespacedName{Namespace: fc.GetNamespace(), Name: fc.GetName()}

	if fc.GetDeletionTimestamp() != nil {
		return r.release(ctx, fc)
	}
	// 연결담보 finalizer 보장(claim 삭제가 release 완료 전까지 Terminating에 머무름)
	if !hasFinalizer(fc, finalizer) {
		if err := updateMetaRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) { addFinalizer(o, finalizer) }); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{Requeue: true}, nil
	}
	model, _, _ := unstructured.NestedString(fc.Object, "spec", "model")
	b, hasBundle := bundles[model]
	// 모델 FM 조회(설치 NS 의존 endpoint/probe 계산용 — endpointFM/probeFM).
	fmObj := gvkObj(fmGVK)
	fmErr := r.cached.Get(ctx, types.NamespacedName{Name: model}, fmObj)
	installed := fmErr == nil && func() bool { ph, _, _ := unstructured.NestedString(fmObj.Object, "status", "phase"); return ph == "Installed" }()
	hasEP := hasBundle && (b.endpoint != nil || b.endpointFM != nil)
	hasPr := hasBundle && (b.probe != nil || b.probeFM != nil)
	epOf := func() string { if b.endpointFM != nil { return b.endpointFM(r.cfg, fmObj) }; if b.endpoint != nil { return b.endpoint(r.cfg) }; return "" }
	prOf := func() string { if b.probeFM != nil { return b.probeFM(r.cfg, fmObj) }; if b.probe != nil { return b.probe(r.cfg) }; return "" }
	// endpoint/probe는 bind 필수 — 누락한 레지스트리 항목(install-only 모델 등)은 nil-deref 대신 Pending 처리.
	if !hasEP || !hasPr || !installed {
		if err := updateStatusRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) { setNested(o, "Pending", "status", "phase") }); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
	}

	bindingName := fc.GetName() + "-binding"
	bnn := types.NamespacedName{Namespace: fc.GetNamespace(), Name: bindingName}

	// 방어(HIGH): Binding이 외부에서 삭제되어 Terminating(finalizer 보류) 상태면 재적용으로 finalizer를 다시 박지 말고
	// finalizer를 풀어 소멸시킨 뒤 다음 reconcile에서 깨끗이 재생성한다(공유 collector라 cleanup은 no-op). 데드락 방지.
	existing := gvkObj(fbGVK)
	if gerr := r.direct.Get(ctx, bnn, existing); gerr == nil && existing.GetDeletionTimestamp() != nil {
		if uerr := updateMetaRetry(ctx, r.direct, fbGVK, bnn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil && !apierrors.IsNotFound(uerr) {
			return reconcile.Result{}, uerr
		}
		return reconcile.Result{RequeueAfter: 2 * time.Second}, nil
	}

	// Binding 발급(SSA) — finalizer + ownerRef→Claim(같은 ns, controller=true). endpoint는 모델별(observability=collector, identity=issuer).
	if err := applyObj(ctx, r.direct, r.buildBinding(fc, bindingName, model, epOf())); err != nil {
		return reconcile.Result{}, err
	}
	// Binding status — 구조적 스키마라 스키마 필드만(rttMs 정수). availability는 정직상 생략. probe도 모델별 대상.
	rtt, connected := probeTCP(ctx, prOf())
	if err := updateStatusRetry(ctx, r.direct, fbGVK, bnn, func(o *unstructured.Unstructured) {
		if connected {
			setNested(o, "Connected", "status", "phase")
			setNested(o, int64(rtt), "status", "connection", "rttMs")
			setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "connection", "lastCheck")
		} else {
			// Degraded면 직전 성공값(rttMs)을 남기지 않는다 — stale RTT 표시 방지. lastCheck는 갱신(정직).
			setNested(o, "Degraded", "status", "phase")
			setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "connection", "lastCheck")
			unstructured.RemoveNestedField(o.Object, "status", "connection", "rttMs")
		}
	}); err != nil {
		return reconcile.Result{}, err
	}

	// Claim status — 스키마 필드만(phase enum[Pending,Bound,Failed], bindingRef). Bound=Binding 발급 완료(실연결성은 Binding.phase가 권위).
	if err := updateStatusRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, "Bound", "status", "phase")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"name": bindingName, "namespace": fc.GetNamespace()}, "status", "bindingRef")
	}); err != nil {
		return reconcile.Result{}, err
	}
	log.Info("claim bound", "claim", fc.GetName(), "binding", bindingName, "connected", connected)
	return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
}

// release — claim 삭제 시: cleanup → Binding Released → Binding finalizer 제거 → Binding 소멸 후 Claim finalizer 제거.
// cleanup 실패 시 finalizer를 남긴 채 requeue(담보 유지). observability는 공유 collector라 cleanup이 명시적 no-op → 항상 완료.
func (r *claimReconciler) release(ctx context.Context, fc *unstructured.Unstructured) (reconcile.Result, error) {
	nn := types.NamespacedName{Namespace: fc.GetNamespace(), Name: fc.GetName()}
	bindingName := fc.GetName() + "-binding"
	bnn := types.NamespacedName{Namespace: fc.GetNamespace(), Name: bindingName}
	b := gvkObj(fbGVK)
	err := r.direct.Get(ctx, bnn, b)
	if err == nil {
		// (a) cleanup: observability는 공유 collector(FoundationModel 소유)라 회수 대상 없음 → 명시적 no-op.
		if b.GetDeletionTimestamp() == nil {
			// (b) Binding Released 표기(best-effort) 후 삭제 요청(finalizer가 실제 소멸을 보류).
			_ = updateStatusRetry(ctx, r.direct, fbGVK, bnn, func(o *unstructured.Unstructured) { setNested(o, "Released", "status", "phase") })
			if derr := r.direct.Delete(ctx, b); derr != nil && !apierrors.IsNotFound(derr) {
				return reconcile.Result{}, derr
			}
			return reconcile.Result{Requeue: true}, nil
		}
		// 삭제 진행 중 → finalizer 제거(담보 해제) → Binding 실제 소멸. 동시 GC로 이미 사라졌으면 NotFound 무시(목표 달성).
		if uerr := updateMetaRetry(ctx, r.direct, fbGVK, bnn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil && !apierrors.IsNotFound(uerr) {
			return reconcile.Result{}, uerr
		}
		return reconcile.Result{Requeue: true}, nil
	}
	if !apierrors.IsNotFound(err) {
		return reconcile.Result{}, err
	}
	// Binding 소멸 확인 → Claim finalizer 제거(삭제 완료)
	if uerr := updateMetaRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil {
		return reconcile.Result{}, client.IgnoreNotFound(uerr)
	}
	return reconcile.Result{}, nil
}

func (r *claimReconciler) modelInstalled(ctx context.Context, model string) bool {
	if model == "" {
		return false
	}
	fm := gvkObj(fmGVK)
	if err := r.cached.Get(ctx, types.NamespacedName{Name: model}, fm); err != nil {
		return false
	}
	phase, _, _ := unstructured.NestedString(fm.Object, "status", "phase")
	return phase == "Installed"
}

func (r *claimReconciler) buildBinding(fc *unstructured.Unstructured, name, model, endpoint string) *unstructured.Unstructured {
	b := gvkObj(fbGVK)
	b.SetName(name)
	b.SetNamespace(fc.GetNamespace())
	b.SetFinalizers([]string{finalizer})
	stampLabels(b, model, fc.GetName())
	_ = unstructured.SetNestedSlice(b.Object, []interface{}{
		map[string]interface{}{
			"apiVersion":         grp + "/" + ver,
			"kind":               "FoundationClaim",
			"name":               fc.GetName(),
			"uid":                string(fc.GetUID()),
			"controller":         true,
			"blockOwnerDeletion": true,
		},
	}, "metadata", "ownerReferences")
	_ = unstructured.SetNestedMap(b.Object, map[string]interface{}{
		"name":      fc.GetName(),
		"namespace": fc.GetNamespace(),
	}, "spec", "claimRef")
	setNested(b, endpoint, "spec", "endpoint")
	return b
}
