package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestValkeyCredentialNameIsExact(t *testing.T) {
	if valkeyDefaultAuthSecret != "foundation-data-valkey-auth" {
		t.Fatalf("unexpected Valkey credential name %q", valkeyDefaultAuthSecret)
	}
}

func TestStampValkeyCredentialRevision(t *testing.T) {
	valkey := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "StatefulSet",
		"metadata":   map[string]interface{}{"name": valkeyName},
		"spec": map[string]interface{}{
			"template": map[string]interface{}{"metadata": map[string]interface{}{}},
		},
	}}
	other := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "StatefulSet",
		"metadata":   map[string]interface{}{"name": "unrelated"},
		"spec": map[string]interface{}{
			"template": map[string]interface{}{"metadata": map[string]interface{}{}},
		},
	}}

	if err := stampValkeyCredentialRevision([]*unstructured.Unstructured{valkey, other}, "12345"); err != nil {
		t.Fatal(err)
	}
	got, found, err := unstructured.NestedString(valkey.Object, "spec", "template", "metadata", "annotations", "foundation.opensphere.io/valkey-credential-resource-version")
	if err != nil || !found || got != "12345" {
		t.Fatalf("Valkey revision = %q, found=%v, err=%v", got, found, err)
	}
	if _, found, _ := unstructured.NestedStringMap(other.Object, "spec", "template", "metadata", "annotations"); found {
		t.Fatal("unrelated StatefulSet was stamped")
	}
}
