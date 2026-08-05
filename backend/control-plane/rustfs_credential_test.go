package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestRustFSCredentialNameIsExact(t *testing.T) {
	if rustfsDefaultAuthSecret != "rustfs-credentials" {
		t.Fatalf("unexpected RustFS credential name %q", rustfsDefaultAuthSecret)
	}
}

func TestStampRustFSCredentialRevision(t *testing.T) {
	rustfs := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1", "kind": "StatefulSet",
		"metadata": map[string]interface{}{"name": rustfsName},
		"spec":     map[string]interface{}{"template": map[string]interface{}{"metadata": map[string]interface{}{}}},
	}}
	other := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1", "kind": "StatefulSet",
		"metadata": map[string]interface{}{"name": valkeyName},
		"spec":     map[string]interface{}{"template": map[string]interface{}{"metadata": map[string]interface{}{}}},
	}}
	if err := stampRustFSCredentialRevision([]*unstructured.Unstructured{rustfs, other}, "98765"); err != nil {
		t.Fatal(err)
	}
	got, found, err := unstructured.NestedString(rustfs.Object, "spec", "template", "metadata", "annotations", "foundation.opensphere.io/rustfs-credential-resource-version")
	if err != nil || !found || got != "98765" {
		t.Fatalf("RustFS revision = %q, found=%v, err=%v", got, found, err)
	}
	if _, found, _ := unstructured.NestedString(other.Object, "spec", "template", "metadata", "annotations", "foundation.opensphere.io/rustfs-credential-resource-version"); found {
		t.Fatal("RustFS revision leaked into another StatefulSet")
	}
}
