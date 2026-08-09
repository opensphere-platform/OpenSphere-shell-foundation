package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestWorkloadReadyRequiresDesiredReplicasAndObservedGeneration(t *testing.T) {
	o := &unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{"generation": int64(4)},
		"spec":     map[string]interface{}{"replicas": int64(2)},
		"status":   map[string]interface{}{"readyReplicas": int64(2), "observedGeneration": int64(4)},
	}}
	if !workloadReady(o) {
		t.Fatal("expected fully observed workload to be ready")
	}
	_ = unstructured.SetNestedField(o.Object, int64(3), "status", "observedGeneration")
	if workloadReady(o) {
		t.Fatal("stale observedGeneration must not be ready")
	}
}

func TestDeliveryBundleDoesNotTakeOwnershipOfExternalOperators(t *testing.T) {
	objects, err := buildDeliveryBundle(&config{}, &unstructured.Unstructured{})
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 0 {
		t.Fatalf("external operator adapter must not render owned workloads: %d", len(objects))
	}
}
