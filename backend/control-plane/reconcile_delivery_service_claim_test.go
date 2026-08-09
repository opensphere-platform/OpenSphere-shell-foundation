package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestArgoApplicationMustBeSyncedAndHealthy(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]interface{}{
		"status": map[string]interface{}{
			"health": map[string]interface{}{"status": "Healthy"},
			"sync":   map[string]interface{}{"status": "Synced"},
		},
	}}
	if !argoApplicationReady(resource) {
		t.Fatal("expected synced healthy Application to be ready")
	}
	_ = unstructured.SetNestedField(resource.Object, "OutOfSync", "status", "sync", "status")
	if argoApplicationReady(resource) {
		t.Fatal("out-of-sync Application must not bind")
	}
}

func TestCrossplaneConditionsAreFailClosed(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]interface{}{
		"status": map[string]interface{}{"conditions": []interface{}{
			map[string]interface{}{"type": "Installed", "status": "True"},
			map[string]interface{}{"type": "Healthy", "status": "True"},
		}},
	}}
	if !conditionTrue(resource, "Installed", "Healthy") {
		t.Fatal("expected both authoritative conditions")
	}
	if conditionTrue(resource, "Ready") {
		t.Fatal("missing condition must fail closed")
	}
}
