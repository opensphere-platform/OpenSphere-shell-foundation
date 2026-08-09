package main

import (
	"context"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	argoCDNamespace     = "argocd"
	crossplaneNamespace = "crossplane-system"
)

var crdGVK = schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"}

// buildDeliveryBundle intentionally owns no Argo CD or Crossplane workload.
// Those products already have their own cluster-scoped operators and release
// lifecycles. Foundation is their northbound adapter: it discovers the
// official operators and projects readiness through the common PFS contract
// without stealing southbound ownership.
func buildDeliveryBundle(_ *config, _ *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	return []*unstructured.Unstructured{}, nil
}

func workloadReady(o *unstructured.Unstructured) bool {
	desired, found, _ := unstructured.NestedInt64(o.Object, "spec", "replicas")
	if !found || desired < 1 {
		desired = 1
	}
	ready, _, _ := unstructured.NestedInt64(o.Object, "status", "readyReplicas")
	generation, _, _ := unstructured.NestedInt64(o.Object, "metadata", "generation")
	observed, _, _ := unstructured.NestedInt64(o.Object, "status", "observedGeneration")
	return ready >= desired && observed >= generation
}

func (r *modelReconciler) externalWorkloadReady(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) bool {
	o := gvkObj(gvk)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, o); err != nil {
		return false
	}
	return workloadReady(o)
}

func (r *modelReconciler) crdEstablished(ctx context.Context, name string) bool {
	o := gvkObj(crdGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Name: name}, o); err != nil {
		return false
	}
	conditions, _, _ := unstructured.NestedSlice(o.Object, "status", "conditions")
	for _, raw := range conditions {
		condition, ok := raw.(map[string]interface{})
		if ok && condition["type"] == "Established" && condition["status"] == "True" {
			return true
		}
	}
	return false
}

func (r *modelReconciler) argoCDReady(ctx context.Context) bool {
	return r.crdEstablished(ctx, "applications.argoproj.io") &&
		r.externalWorkloadReady(ctx, depGVK, argoCDNamespace, "argocd-server") &&
		r.externalWorkloadReady(ctx, depGVK, argoCDNamespace, "argocd-repo-server") &&
		r.externalWorkloadReady(ctx, statefulSetGVK, argoCDNamespace, "argocd-application-controller")
}

func (r *modelReconciler) crossplaneReady(ctx context.Context) bool {
	return r.crdEstablished(ctx, "providers.pkg.crossplane.io") &&
		r.crdEstablished(ctx, "objects.kubernetes.m.crossplane.io") &&
		r.externalWorkloadReady(ctx, depGVK, crossplaneNamespace, "crossplane") &&
		r.externalWorkloadReady(ctx, depGVK, crossplaneNamespace, "crossplane-rbac-manager")
}

func deliveryReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	ready := true
	if engineEnabled(fm, "argocd") {
		ready = ready && r.argoCDReady(ctx)
	}
	if engineEnabled(fm, "crossplane") {
		ready = ready && r.crossplaneReady(ctx)
	}
	return ready
}

func observeDelivery(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, _ bool) ([]interface{}, map[string]interface{}) {
	type engine struct {
		id       string
		ready    func(context.Context) bool
		endpoint string
		source   string
	}
	engines := []engine{
		{id: "argocd", ready: r.argoCDReady, endpoint: "https://argocd-server.argocd.svc:443", source: "Application CRD + Argo CD workload status"},
		{id: "crossplane", ready: r.crossplaneReady, endpoint: "https://crossplane-webhooks.crossplane-system.svc:9443", source: "Provider/Object CRD + Crossplane workload status"},
	}
	observed := make([]interface{}, 0, len(engines)*2)
	for _, item := range engines {
		enabled := engineEnabled(fm, item.id)
		up := false
		if enabled {
			up = item.ready(ctx)
		}
		value := "n/a"
		if enabled {
			value = "0"
			if up {
				value = "1"
			}
		}
		observed = append(observed,
			map[string]interface{}{"id": item.id + "_up", "unit": "bool", "value": value, "healthy": up, "source": item.source},
			map[string]interface{}{"id": item.id + "_endpoint", "unit": "", "value": item.endpoint, "healthy": up, "source": "cluster Service discovery"},
		)
	}
	return observed, nil
}

func deliveryGone(context.Context, *modelReconciler, *unstructured.Unstructured) bool {
	// Withdrawal must not delete workloads owned by the external operators.
	return true
}

func externalOperatorVersion(_ *config) string { return "external-operators:discovered" }

func deliveryEndpoint(_ *config) string { return "https://argocd-server.argocd.svc:443" }

func deliveryProbe(_ *config) string { return "argocd-server.argocd.svc:443" }
