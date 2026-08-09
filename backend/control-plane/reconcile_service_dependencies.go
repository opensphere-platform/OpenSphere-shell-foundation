package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// reconcileServiceDependencies turns the dependency graph declared in the
// PFSS catalog into real child FoundationClaims.  A parent claim cannot become
// Bound until every required dependency has a connected FoundationBinding.
// Optional dependencies are only reconciled when the consumer supplied an
// explicit override.
func (r *claimReconciler) reconcileServiceDependencies(
	ctx context.Context,
	claim *unstructured.Unstructured,
	contract serviceModuleContract,
) ([]serviceDependencyBinding, string, error) {
	bindings := make([]serviceDependencyBinding, 0, len(contract.Dependencies))
	for _, dependency := range contract.Dependencies {
		override, configured := serviceDependencyOverride(claim, dependency.Module)
		if !dependency.Required && !configured {
			continue
		}
		if strings.HasPrefix(dependency.Module, "external:") {
			binding, reason, err := r.resolveExternalDependency(ctx, claim, dependency, override)
			if err != nil || reason != "" {
				return bindings, reason, err
			}
			bindings = append(bindings, binding)
			continue
		}

		dependencyContract, ok := serviceContract(dependency.Module)
		if !ok {
			return bindings, "DependencyContractMissing", nil
		}
		targetRef, _, _ := unstructured.NestedMap(override, "targetRef")
		if dependencyNeedsTarget(dependency.Module, dependency.RequestType) && len(targetRef) == 0 {
			instanceName := dependencyClaimName(claim.GetName(), dependency.Module, "Instance")
			instanceBinding, reason, err := r.ensureDependencyClaim(ctx, claim, dependencyContract, "Instance", instanceName, nil, override, dependency.Required)
			if err != nil || reason != "" {
				return bindings, reason, err
			}
			bindings = append(bindings, instanceBinding)
			targetRef = map[string]interface{}{
				"apiVersion": grp + "/" + ver,
				"kind":       "FoundationClaim",
				"name":       instanceName,
				"namespace":  claim.GetNamespace(),
			}
		}
		name := dependencyClaimName(claim.GetName(), dependency.Module, dependency.RequestType)
		binding, reason, err := r.ensureDependencyClaim(ctx, claim, dependencyContract, dependency.RequestType, name, targetRef, override, dependency.Required)
		if err != nil || reason != "" {
			return bindings, reason, err
		}
		bindings = append(bindings, binding)
	}
	return bindings, "", nil
}

func dependencyNeedsTarget(module, requestType string) bool {
	if requestType != "Database" && requestType != "Access" {
		return false
	}
	return module == "postgres" || module == "percona-psmdb"
}

func serviceDependencyOverride(claim *unstructured.Unstructured, module string) (map[string]interface{}, bool) {
	for _, key := range []string{module, strings.ReplaceAll(module, ":", "-")} {
		value, found, _ := unstructured.NestedMap(claim.Object, "spec", "parameters", "dependencies", key)
		if found {
			return value, true
		}
	}
	return map[string]interface{}{}, false
}

func dependencyClaimName(parent, module, requestType string) string {
	module = strings.TrimPrefix(module, "external:")
	raw := strings.ToLower(strings.Join([]string{parent, "dep", module, requestType}, "-"))
	raw = strings.ReplaceAll(raw, "_", "-")
	if len(raw) <= 63 {
		return strings.Trim(raw, "-")
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(raw)))[:8]
	return strings.Trim(raw[:54], "-") + "-" + hash
}

func (r *claimReconciler) ensureDependencyClaim(
	ctx context.Context,
	parent *unstructured.Unstructured,
	contract serviceModuleContract,
	requestType, name string,
	targetRef, override map[string]interface{},
	required bool,
) (serviceDependencyBinding, string, error) {
	child := object(fcGVK, parent.GetNamespace(), name)
	spec := map[string]interface{}{
		"model": contract.Model, "module": contract.ID,
		"request": map[string]interface{}{"type": requestType},
	}
	if len(targetRef) > 0 {
		spec["request"].(map[string]interface{})["targetRef"] = targetRef
	}
	for _, field := range []string{"profileRef", "credentialSecretRef", "parameters"} {
		if value, found, _ := unstructured.NestedMap(override, field); found && len(value) > 0 {
			spec[field] = value
		}
	}
	child.Object["spec"] = spec
	child.SetLabels(map[string]string{
		lblManagedBy: cpManagedBy, lblPartOf: "foundation-service-dependency",
		lblModel: contract.Model, lblEngine: contract.EngineID,
		"foundation.opensphere.io/dependency-of": parent.GetName(),
	})
	_ = unstructured.SetNestedSlice(child.Object, []interface{}{unstructuredOwnerReference(parent)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, child); err != nil {
		return serviceDependencyBinding{}, "", err
	}

	current := gvkObj(fcGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: parent.GetNamespace(), Name: name}, current); err != nil {
		return serviceDependencyBinding{}, "DependencyPending", nil
	}
	phase, _, _ := unstructured.NestedString(current.Object, "status", "phase")
	bindingRef, _, _ := unstructured.NestedMap(current.Object, "status", "bindingRef")
	if phase != "Bound" || len(bindingRef) == 0 {
		return serviceDependencyBinding{}, "DependencyPending", nil
	}
	if _, ok := bindingRef["namespace"]; !ok {
		bindingRef["namespace"] = parent.GetNamespace()
	}
	binding, reason, err := r.connectedDependencyBinding(ctx, bindingRef)
	if err != nil || reason != "" {
		return serviceDependencyBinding{}, reason, err
	}
	return serviceDependencyBinding{
		Module: contract.ID, RequestType: requestType, Required: required,
		BindingRef: bindingRef, ResourceRef: targetRefOfBinding(binding), Endpoint: bindingEndpoint(binding),
	}, "", nil
}

func (r *claimReconciler) connectedDependencyBinding(ctx context.Context, ref map[string]interface{}) (*unstructured.Unstructured, string, error) {
	name, _ := ref["name"].(string)
	namespace, _ := ref["namespace"].(string)
	if name == "" {
		return nil, "DependencyBindingNotReady", nil
	}
	binding := gvkObj(fbGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, binding); err != nil {
		return nil, "DependencyBindingNotReady", nil
	}
	phase, _, _ := unstructured.NestedString(binding.Object, "status", "phase")
	if phase != "Connected" {
		return nil, "DependencyBindingNotConnected", nil
	}
	return binding, "", nil
}

func bindingEndpoint(binding *unstructured.Unstructured) string {
	endpoint, _, _ := unstructured.NestedString(binding.Object, "spec", "endpoint")
	return endpoint
}

func targetRefOfBinding(binding *unstructured.Unstructured) map[string]interface{} {
	ref, _, _ := unstructured.NestedMap(binding.Object, "spec", "resourceRef")
	return ref
}

func (r *claimReconciler) resolveExternalDependency(
	ctx context.Context,
	claim *unstructured.Unstructured,
	dependency serviceDependency,
	override map[string]interface{},
) (serviceDependencyBinding, string, error) {
	if ref, found, _ := unstructured.NestedMap(override, "bindingRef"); found {
		if _, ok := ref["namespace"]; !ok {
			ref["namespace"] = claim.GetNamespace()
		}
		binding, reason, err := r.connectedDependencyBinding(ctx, ref)
		if err != nil || reason != "" {
			return serviceDependencyBinding{}, reason, err
		}
		return serviceDependencyBinding{
			Module: dependency.Module, RequestType: dependency.RequestType, Required: dependency.Required,
			BindingRef: ref, ResourceRef: targetRefOfBinding(binding), Endpoint: bindingEndpoint(binding),
		}, "", nil
	}
	ref, found, _ := unstructured.NestedMap(override, "targetRef")
	endpoint, _, _ := unstructured.NestedString(override, "endpoint")
	if !found || endpoint == "" {
		return serviceDependencyBinding{}, "ExternalDependencyReferenceRequired", nil
	}
	apiVersion, _ := ref["apiVersion"].(string)
	kind, _ := ref["kind"].(string)
	name, _ := ref["name"].(string)
	namespace, _ := ref["namespace"].(string)
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil || kind == "" || name == "" {
		return serviceDependencyBinding{}, "ExternalDependencyReferenceInvalid", nil
	}
	resource := gvkObj(gv.WithKind(kind))
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, resource); err != nil {
		return serviceDependencyBinding{}, "ExternalDependencyNotReady", nil
	}
	return serviceDependencyBinding{
		Module: dependency.Module, RequestType: dependency.RequestType, Required: dependency.Required,
		ResourceRef: ref, Endpoint: endpoint,
	}, "", nil
}
