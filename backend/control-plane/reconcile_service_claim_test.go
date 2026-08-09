package main

import (
	"encoding/base64"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestServiceBindingProjectionPublishesStructuredContract(t *testing.T) {
	binding := gvkObj(fbGVK)
	projection := serviceBindingProjection{
		Module: "valkey", Endpoint: "redis://foundation-data-valkey.opensphere-foundation.svc:6379",
		Probe:        "foundation-data-valkey.opensphere-foundation.svc:6379",
		Capabilities: []string{"resp", "acl", "persistence"},
		SecretRef:    map[string]interface{}{"name": "cache-auth", "namespace": "tenant-a"},
		ResourceRef:  map[string]interface{}{"apiVersion": grp + "/" + ver, "kind": "FoundationModel", "name": "data"},
	}
	projection.apply(binding)
	if module, _, _ := unstructured.NestedString(binding.Object, "spec", "module"); module != "valkey" {
		t.Fatalf("module=%q", module)
	}
	endpoints, _, _ := unstructured.NestedSlice(binding.Object, "spec", "endpoints")
	if len(endpoints) != 1 || endpoints[0].(map[string]interface{})["protocol"] != "redis" {
		t.Fatalf("endpoints=%v", endpoints)
	}
	capabilities, _, _ := unstructured.NestedStringSlice(binding.Object, "spec", "capabilities")
	if len(capabilities) != 3 {
		t.Fatalf("capabilities=%v", capabilities)
	}
}

func TestSecretStringReadsServiceBindingDataWithoutExposingItInClaim(t *testing.T) {
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "Secret",
		"data": map[string]interface{}{"uri": base64.StdEncoding.EncodeToString([]byte("postgresql://db:5432/orders"))},
	}}
	if got := secretString(secret, "uri"); got != "postgresql://db:5432/orders" {
		t.Fatalf("uri=%q", got)
	}
}
