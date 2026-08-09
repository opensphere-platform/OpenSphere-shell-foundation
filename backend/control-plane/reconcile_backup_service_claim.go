package main

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var (
	backupPolicyGVK = schema.GroupVersionKind{Group: "backup.opensphere.io", Version: "v1alpha1", Kind: "BackupPolicy"}
	restoreRunGVK   = schema.GroupVersionKind{Group: "backup.opensphere.io", Version: "v1alpha1", Kind: "RestoreRun"}
)

func backupResourceName(claim *unstructured.Unstructured, suffix string) string {
	name := strings.Trim(strings.ToLower(claim.GetName()+"-"+suffix), "-")
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func renderBackupPolicyServiceClaim(claim *unstructured.Unstructured) (*unstructured.Unstructured, string) {
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	schedule, _ := parameters["schedule"].(string)
	if strings.TrimSpace(schedule) == "" {
		schedule = "0 2 * * *"
	}
	retention := int64(30)
	if value, ok := parameters["retentionDays"].(int64); ok && value > 0 {
		retention = value
	} else if value, ok := parameters["retentionDays"].(float64); ok && value > 0 {
		retention = int64(value)
	}
	included := []interface{}{claim.GetNamespace()}
	if values, ok := parameters["includedNamespaces"].([]interface{}); ok && len(values) > 0 {
		included = values
	}
	external, _ := parameters["externalChannelRef"].(map[string]interface{})
	binding, _ := parameters["bindingSecretRef"].(map[string]interface{})
	if external == nil || strings.TrimSpace(fmt.Sprint(external["id"])) == "" {
		return nil, "ExternalChannelRequired"
	}
	if binding == nil || strings.TrimSpace(fmt.Sprint(binding["name"])) == "" {
		return nil, "StorageBindingRequired"
	}
	preUpgrade := true
	if value, ok := parameters["preUpgradeGate"].(bool); ok {
		preUpgrade = value
	}
	name := backupResourceName(claim, "policy")
	resource := object(backupPolicyGVK, claim.GetNamespace(), name)
	resource.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":               "foundation-control-plane",
		"foundation.opensphere.io/service-claim":     claim.GetName(),
		"foundation.opensphere.io/service-namespace": claim.GetNamespace(),
	})
	resource.Object["spec"] = map[string]interface{}{
		"schedule": schedule, "retentionDays": retention, "includedNamespaces": included, "preUpgradeGate": preUpgrade,
		"storage": map[string]interface{}{"externalChannelRef": external, "bindingSecretRef": binding},
	}
	return resource, ""
}

func renderRestoreServiceClaim(claim *unstructured.Unstructured) (*unstructured.Unstructured, string) {
	target := targetRefOf(claim)
	backupRunName := strings.TrimSpace(fmt.Sprint(target["name"]))
	if backupRunName == "" {
		return nil, "BackupRunRequired"
	}
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	name := backupResourceName(claim, "restore")
	resource := object(restoreRunGVK, claim.GetNamespace(), name)
	resource.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":               "foundation-control-plane",
		"foundation.opensphere.io/service-claim":     claim.GetName(),
		"foundation.opensphere.io/service-namespace": claim.GetNamespace(),
	})
	spec := map[string]interface{}{"backupRunRef": backupRunName}
	if targetNamespace, ok := parameters["targetNamespace"].(string); ok && strings.TrimSpace(targetNamespace) != "" {
		spec["targetNamespace"] = strings.TrimSpace(targetNamespace)
	}
	resource.Object["spec"] = spec
	return resource, ""
}

func (r *claimReconciler) resolveBackupServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	requestType := requestTypeOf(claim)
	if requestType == "Access" {
		return serviceBindingProjection{
			Module: contract.ID, Endpoint: "https://kubernetes.default.svc:443", Probe: "kubernetes.default.svc:443",
			Capabilities: append([]string(nil), contract.Capabilities...),
			ResourceRef:  map[string]interface{}{"apiVersion": "backup.opensphere.io/v1alpha1", "kind": "BackupPolicy", "name": "*", "namespace": claim.GetNamespace()},
		}, "", nil
	}
	var resource *unstructured.Unstructured
	var reason string
	var gvk schema.GroupVersionKind
	var readyPhase string
	if requestType == "BackupPolicy" {
		resource, reason = renderBackupPolicyServiceClaim(claim)
		gvk, readyPhase = backupPolicyGVK, "Ready"
	} else if requestType == "Restore" {
		resource, reason = renderRestoreServiceClaim(claim)
		gvk, readyPhase = restoreRunGVK, "Succeeded"
	} else {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	if reason != "" {
		return serviceBindingProjection{}, reason, nil
	}
	if err := applyObj(ctx, r.direct, resource); err != nil {
		return serviceBindingProjection{}, "", err
	}
	observed := gvkObj(gvk)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: resource.GetNamespace(), Name: resource.GetName()}, observed); err != nil {
		return serviceBindingProjection{}, "BackupResourceNotReady", clientIgnoreNotFound(err)
	}
	phase, _, _ := unstructured.NestedString(observed.Object, "status", "phase")
	if phase != readyPhase {
		return serviceBindingProjection{}, resource.GetKind() + "NotReady", nil
	}
	return serviceBindingProjection{
		Module: contract.ID, Endpoint: "https://kubernetes.default.svc:443", Probe: "kubernetes.default.svc:443",
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef:  map[string]interface{}{"apiVersion": gvk.Group + "/" + gvk.Version, "kind": gvk.Kind, "name": resource.GetName(), "namespace": resource.GetNamespace()},
	}, "", nil
}

func clientIgnoreNotFound(err error) error {
	if apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func (r *claimReconciler) cleanupBackupServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	requestType := requestTypeOf(claim)
	var gvk schema.GroupVersionKind
	var name string
	if requestType == "BackupPolicy" {
		gvk, name = backupPolicyGVK, backupResourceName(claim, "policy")
	} else if requestType == "Restore" {
		gvk, name = restoreRunGVK, backupResourceName(claim, "restore")
	} else {
		return true, nil
	}
	resource := gvkObj(gvk)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, resource)
	if apierrors.IsNotFound(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if resource.GetDeletionTimestamp() == nil {
		if err := r.direct.Delete(ctx, resource); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	return false, nil
}
