package main

import (
	"encoding/base64"
	"strings"
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
	if err := projection.apply(binding); err != nil {
		t.Fatal(err)
	}
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

func TestServiceBindingProjectionRejectsCredentialBearingEndpoint(t *testing.T) {
	binding := gvkObj(fbGVK)
	projection := serviceBindingProjection{Module: "postgres", Endpoint: "postgresql://owner:canary-password@db.example:5432/orders"}
	if err := projection.apply(binding); err == nil {
		t.Fatal("credential-bearing endpoint must be rejected")
	}
	if endpoints, found, _ := unstructured.NestedSlice(binding.Object, "spec", "endpoints"); found || len(endpoints) != 0 {
		t.Fatalf("credential-bearing endpoint leaked into binding: %v", endpoints)
	}
}

func TestCredentialFreeEndpointRejectsSensitiveQuery(t *testing.T) {
	if _, err := credentialFreeEndpoint("postgresql://db.example:5432/orders?password=canary-password"); err == nil {
		t.Fatal("sensitive query must be rejected")
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

func TestPostgresPublicEndpointIgnoresCredentialBearingURI(t *testing.T) {
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "Secret",
		"stringData": map[string]interface{}{
			"host": "orders-db.tenant-a.svc", "port": "5432", "database": "orders",
			"username": "orders_app", "password": "canary-password",
			"uri": "postgresql://orders_app:canary-password@orders-db.tenant-a.svc:5432/orders",
		},
	}}
	endpoint, host, port, ok := postgresPublicEndpoint(secret)
	if !ok || host != "orders-db.tenant-a.svc" || port != "5432" || endpoint != "postgresql://orders-db.tenant-a.svc:5432/orders" {
		t.Fatalf("public endpoint=%q host=%q port=%q ok=%t", endpoint, host, port, ok)
	}
	if strings.Contains(endpoint, "orders_app") || strings.Contains(endpoint, "canary-password") {
		t.Fatalf("credential leaked in public endpoint: %s", endpoint)
	}
}
