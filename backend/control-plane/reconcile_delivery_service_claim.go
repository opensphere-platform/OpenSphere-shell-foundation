package main

import (
	"context"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var (
	argoApplicationGVK    = schema.GroupVersionKind{Group: "argoproj.io", Version: "v1alpha1", Kind: "Application"}
	argoProjectGVK        = schema.GroupVersionKind{Group: "argoproj.io", Version: "v1alpha1", Kind: "AppProject"}
	crossplaneProviderGVK = schema.GroupVersionKind{Group: "pkg.crossplane.io", Version: "v1", Kind: "Provider"}
	crossplaneObjectV1GVK = schema.GroupVersionKind{Group: "kubernetes.m.crossplane.io", Version: "v1alpha1", Kind: "Object"}
)

func targetNameNamespace(claim *unstructured.Unstructured, defaultNamespace string) (string, string) {
	ref := targetRefOf(claim)
	name, _ := ref["name"].(string)
	namespace, _ := ref["namespace"].(string)
	if namespace == "" {
		namespace = defaultNamespace
	}
	return strings.TrimSpace(name), strings.TrimSpace(namespace)
}

func conditionTrue(resource *unstructured.Unstructured, names ...string) bool {
	conditions, _, _ := unstructured.NestedSlice(resource.Object, "status", "conditions")
	for _, name := range names {
		matched := false
		for _, raw := range conditions {
			condition, ok := raw.(map[string]interface{})
			if ok && condition["type"] == name {
				matched = condition["status"] == "True"
				break
			}
		}
		if !matched {
			return false
		}
	}
	return len(names) > 0
}

func argoApplicationReady(resource *unstructured.Unstructured) bool {
	health, _, _ := unstructured.NestedString(resource.Object, "status", "health", "status")
	sync, _, _ := unstructured.NestedString(resource.Object, "status", "sync", "status")
	return health == "Healthy" && sync == "Synced"
}

func (r *claimReconciler) resolveDeliveryServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	modelDriver := &modelReconciler{cached: r.cached, direct: r.direct, cfg: r.cfg}
	projection := serviceBindingProjection{
		Module: contract.ID, Capabilities: append([]string(nil), contract.Capabilities...),
	}
	requestType := requestTypeOf(claim)
	if contract.ID == "argocd" {
		if !modelDriver.argoCDReady(ctx) {
			return serviceBindingProjection{}, "ArgoCDNotReady", nil
		}
		projection.Endpoint = "https://argocd-server.argocd.svc:443"
		projection.Probe = "argocd-server.argocd.svc:443"
		if requestType == "Access" {
			projection.ResourceRef = map[string]interface{}{"apiVersion": "argoproj.io/v1alpha1", "kind": "Application", "name": "*", "namespace": argoCDNamespace}
			return projection, "", nil
		}
		name, namespace := targetNameNamespace(claim, argoCDNamespace)
		if name == "" {
			return serviceBindingProjection{}, "ArgoTargetRequired", nil
		}
		gvk := argoApplicationGVK
		if requestType == "Project" {
			gvk = argoProjectGVK
		}
		resource := gvkObj(gvk)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, resource); err != nil {
			return serviceBindingProjection{}, "ArgoTargetNotReady", nil
		}
		if requestType == "Application" && !argoApplicationReady(resource) {
			return serviceBindingProjection{}, "ArgoApplicationNotReady", nil
		}
		projection.ResourceRef = map[string]interface{}{"apiVersion": gvk.Group + "/" + gvk.Version, "kind": gvk.Kind, "name": name, "namespace": namespace}
		return projection, "", nil
	}

	if !modelDriver.crossplaneReady(ctx) {
		return serviceBindingProjection{}, "CrossplaneNotReady", nil
	}
	// Crossplane is a Kubernetes control API, not an application endpoint. Do
	// not expose its admission webhook as a consumer endpoint.
	projection.Endpoint = "https://kubernetes.default.svc:443"
	projection.Probe = "kubernetes.default.svc:443"
	if requestType == "Access" {
		projection.ResourceRef = map[string]interface{}{"apiVersion": "pkg.crossplane.io/v1", "kind": "Provider", "name": "*"}
		return projection, "", nil
	}
	name, namespace := targetNameNamespace(claim, "")
	if name == "" {
		return serviceBindingProjection{}, "CrossplaneTargetRequired", nil
	}
	gvk := crossplaneProviderGVK
	if requestType == "Instance" {
		gvk = crossplaneObjectV1GVK
		if namespace == "" {
			namespace = claim.GetNamespace()
		}
	}
	resource := gvkObj(gvk)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, resource); err != nil {
		return serviceBindingProjection{}, "CrossplaneTargetNotReady", nil
	}
	if requestType == "Provider" && !conditionTrue(resource, "Installed", "Healthy") {
		return serviceBindingProjection{}, "CrossplaneProviderNotReady", nil
	}
	if requestType == "Instance" && !conditionTrue(resource, "Ready", "Synced") {
		return serviceBindingProjection{}, "CrossplaneResourceNotReady", nil
	}
	projection.ResourceRef = map[string]interface{}{"apiVersion": gvk.Group + "/" + gvk.Version, "kind": gvk.Kind, "name": name}
	if namespace != "" {
		projection.ResourceRef["namespace"] = namespace
	}
	return projection, "", nil
}
