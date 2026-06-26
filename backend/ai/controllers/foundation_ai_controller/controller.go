// Package foundation_ai_controller 는 Foundation AI published capability reconciler 다.
package foundation_ai_controller

import (
	"context"
	"log/slog"

	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	aiv1alpha1 "github.com/opensphere/foundation-ai/apis/v1alpha1"
)

// Reconciler 는 LLMRouteClaim 과 VectorRetrievalClaim 의 최소 상태를 수렴한다.
type Reconciler struct {
	client.Client
	Scheme *runtime.Scheme
	Logger *slog.Logger
}

// SetupWithManager 는 Foundation AI claim watch 를 등록한다.
func (r *Reconciler) SetupWithManager(mgr ctrl.Manager) error {
	if err := ctrl.NewControllerManagedBy(mgr).
		For(&aiv1alpha1.LLMRouteClaim{}).
		Complete(&LLMRouteClaimReconciler{Reconciler: r}); err != nil {
		return err
	}
	return ctrl.NewControllerManagedBy(mgr).
		For(&aiv1alpha1.VectorRetrievalClaim{}).
		Complete(&VectorRetrievalClaimReconciler{Reconciler: r})
}

// LLMRouteClaimReconciler 는 LLMRouteClaim 을 reconcile 한다.
type LLMRouteClaimReconciler struct {
	*Reconciler
}

// Reconcile 는 LiteLLM route operand 배포 전까지 capability 상태를 stub-ready 로 둔다.
func (r *LLMRouteClaimReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	claim := &aiv1alpha1.LLMRouteClaim{}
	if err := r.Get(ctx, req.NamespacedName, claim); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	return ctrl.Result{}, r.markReady(ctx, claim, "llm-route pending operand")
}

// VectorRetrievalClaimReconciler 는 VectorRetrievalClaim 을 reconcile 한다.
type VectorRetrievalClaimReconciler struct {
	*Reconciler
}

// Reconcile 는 OpenSearch vector retrieval operand 배포 전까지 capability 상태를 stub-ready 로 둔다.
func (r *VectorRetrievalClaimReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	claim := &aiv1alpha1.VectorRetrievalClaim{}
	if err := r.Get(ctx, req.NamespacedName, claim); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	return ctrl.Result{}, r.markReady(ctx, claim, "vector retrieval pending operand")
}

func (r *Reconciler) markReady(ctx context.Context, obj client.Object, endpoint string) error {
	patch := client.MergeFrom(obj.DeepCopyObject().(client.Object))
	switch o := obj.(type) {
	case *aiv1alpha1.LLMRouteClaim:
		o.Status.Ready = true
		o.Status.Endpoint = endpoint
	case *aiv1alpha1.VectorRetrievalClaim:
		o.Status.Ready = true
		o.Status.Endpoint = endpoint
	}
	return r.Status().Patch(ctx, obj, patch)
}
