package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func backupServiceTestClaim(requestType string, parameters map[string]interface{}) *unstructured.Unstructured {
	claim := gvkObj(fcGVK)
	claim.SetNamespace("consumer-a")
	claim.SetName("orders-protection")
	claim.Object["spec"] = map[string]interface{}{
		"model": "backup", "module": "ptm", "request": map[string]interface{}{"type": requestType}, "parameters": parameters,
	}
	return claim
}

func TestBackupPolicyClaimRequiresExternalChannelAndExactBinding(t *testing.T) {
	claim := backupServiceTestClaim("BackupPolicy", map[string]interface{}{})
	if _, reason := renderBackupPolicyServiceClaim(claim); reason != "ExternalChannelRequired" {
		t.Fatalf("missing external channel reason = %q", reason)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"] = map[string]interface{}{"externalChannelRef": map[string]interface{}{"id": "rgw-id"}}
	if _, reason := renderBackupPolicyServiceClaim(claim); reason != "StorageBindingRequired" {
		t.Fatalf("missing exact binding reason = %q", reason)
	}
}

func TestBackupPolicyClaimRendersNamespacedOperatorResource(t *testing.T) {
	claim := backupServiceTestClaim("BackupPolicy", map[string]interface{}{
		"externalChannelRef": map[string]interface{}{"id": "rgw-id", "name": "RGW-ceph@IDC"},
		"bindingSecretRef":   map[string]interface{}{"name": "rgw-id-backup-binding"},
	})
	resource, reason := renderBackupPolicyServiceClaim(claim)
	if reason != "" {
		t.Fatal(reason)
	}
	if resource.GetKind() != "BackupPolicy" || resource.GetNamespace() != claim.GetNamespace() {
		t.Fatalf("invalid backup resource coordinate: %s/%s %s", resource.GetNamespace(), resource.GetName(), resource.GetKind())
	}
	included, _, _ := unstructured.NestedStringSlice(resource.Object, "spec", "includedNamespaces")
	if len(included) != 1 || included[0] != claim.GetNamespace() {
		t.Fatalf("default backup scope must be the consumer namespace: %#v", included)
	}
	bindingName, _, _ := unstructured.NestedString(resource.Object, "spec", "storage", "bindingSecretRef", "name")
	if bindingName != "rgw-id-backup-binding" {
		t.Fatal("External Channel Binding Secret reference was not preserved")
	}
}

func TestRestoreClaimRendersIsolatedRestoreRequest(t *testing.T) {
	claim := backupServiceTestClaim("Restore", map[string]interface{}{"targetNamespace": "restore-orders-audit"})
	_ = unstructured.SetNestedMap(claim.Object, map[string]interface{}{"name": "orders-nightly-20260810", "kind": "BackupRun"}, "spec", "request", "targetRef")
	resource, reason := renderRestoreServiceClaim(claim)
	if reason != "" {
		t.Fatal(reason)
	}
	backupRunRef, _, _ := unstructured.NestedString(resource.Object, "spec", "backupRunRef")
	targetNamespace, _, _ := unstructured.NestedString(resource.Object, "spec", "targetNamespace")
	if backupRunRef != "orders-nightly-20260810" || targetNamespace != "restore-orders-audit" {
		t.Fatalf("restore intent was not preserved: %s", toJSON(resource.Object))
	}
}
