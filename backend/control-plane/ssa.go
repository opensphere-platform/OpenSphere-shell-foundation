// ssa.go — ADR-005R1(INV-1) 선언형 쓰기의 단일 원천.
// 인프라 변경은 오직 server-side apply(client.Apply) + 라벨기반 회수(DeleteAllOf)로만 한다.
// 명령형 변경(원격 명령 실행/패키지매니저/SQL DDL)은 절대 없다 — g-adr005가 코드·주석을 grep으로 강제.
package main

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	grp      = "foundation.opensphere.io"
	ver      = "v1alpha1"
	fieldMgr = "foundation-control-plane"
	// 연결담보 finalizer — 6 디스크립터 bindContract.finalizer와 동일 리터럴(g-bind 강제).
	finalizer = "foundation.opensphere.io/consumer-protect"

	lblManagedBy      = "app.kubernetes.io/managed-by"
	lblPartOf         = "app.kubernetes.io/part-of"
	lblModel          = "foundation.opensphere.io/model"
	lblOwnerFM        = "foundation.opensphere.io/owner-fm"
	lblDeliveryEngine = "foundation.opensphere.io/delivery-engine" // ADR-FND-006 §3.3 회수 셀렉터 식별자
	// 엔진(내부 plugin) 단위 회수 셀렉터 — 번들 YAML이 오브젝트별로 정적 라벨로 선언(2026-07-06, Samba-AD 편입).
	// parameters.engines.<id>=disabled 시 install()이 이 라벨로 해당 엔진 operand만 회수한다(PVC는 kinds에서 제외 = 보존).
	lblEngine   = "foundation.opensphere.io/engine"
	cpManagedBy = "foundation-control-plane"
)

// applyObj — 유일한 변경 프리미티브. SSA(force ownership). resourceVersion 불필요(apply는 멱등).
func applyObj(ctx context.Context, c client.Client, obj *unstructured.Unstructured) error {
	obj.SetManagedFields(nil)
	return c.Patch(ctx, obj, client.Apply, client.FieldOwner(fieldMgr), client.ForceOwnership)
}

// setNested — status 필드 설정 단축(에러는 JSON 타입 위반 시뿐 → 호출부에서 JSON 타입만 전달).
func setNested(u *unstructured.Unstructured, val interface{}, fields ...string) {
	_ = unstructured.SetNestedField(u.Object, val, fields...)
}

// updateStatusRetry — conflict 안전 status 쓰기. 매 시도마다 신선한 객체를 Get(uncached)해 stale resourceVersion 회피.
func updateStatusRetry(ctx context.Context, c client.Client, gvk schema.GroupVersionKind, nn types.NamespacedName, mutate func(*unstructured.Unstructured)) error {
	var last error
	for i := 0; i < 5; i++ {
		o := &unstructured.Unstructured{}
		o.SetGroupVersionKind(gvk)
		if err := c.Get(ctx, nn, o); err != nil {
			return err
		}
		mutate(o)
		if err := c.Status().Update(ctx, o); err != nil {
			if apierrors.IsConflict(err) {
				last = err
				continue
			}
			return err
		}
		return nil
	}
	return fmt.Errorf("status update conflict 재시도 소진: %s (%v)", nn, last)
}

// updateMetaRetry — conflict 안전 메타데이터 쓰기(finalizer 등).
func updateMetaRetry(ctx context.Context, c client.Client, gvk schema.GroupVersionKind, nn types.NamespacedName, mutate func(*unstructured.Unstructured)) error {
	var last error
	for i := 0; i < 5; i++ {
		o := &unstructured.Unstructured{}
		o.SetGroupVersionKind(gvk)
		if err := c.Get(ctx, nn, o); err != nil {
			return err
		}
		mutate(o)
		if err := c.Update(ctx, o); err != nil {
			if apierrors.IsConflict(err) {
				last = err
				continue
			}
			return err
		}
		return nil
	}
	return fmt.Errorf("meta update conflict 재시도 소진: %s (%v)", nn, last)
}

// stampLabels — 관리객체 소유 라벨(회수 셀렉터·증빙의 단일 원천).
// ADR-FND-006 §3.3: lblDeliveryEngine="ssa" 포함 3종 라벨로 회수 셀렉터 정합.
func stampLabels(u *unstructured.Unstructured, model, ownerFM string) {
	l := u.GetLabels()
	if l == nil {
		l = map[string]string{}
	}
	l[lblManagedBy] = cpManagedBy
	l[lblPartOf] = "foundation-" + model
	l[lblModel] = model
	l[lblOwnerFM] = ownerFM
	l[lblDeliveryEngine] = "ssa"
	u.SetLabels(l)
}

func hasFinalizer(u *unstructured.Unstructured, f string) bool {
	for _, x := range u.GetFinalizers() {
		if x == f {
			return true
		}
	}
	return false
}

func addFinalizer(u *unstructured.Unstructured, f string) {
	if !hasFinalizer(u, f) {
		u.SetFinalizers(append(u.GetFinalizers(), f))
	}
}

func removeFinalizer(u *unstructured.Unstructured, f string) {
	out := make([]string, 0, len(u.GetFinalizers()))
	for _, x := range u.GetFinalizers() {
		if x != f {
			out = append(out, x)
		}
	}
	u.SetFinalizers(out)
}
