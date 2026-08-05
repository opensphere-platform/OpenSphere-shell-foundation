package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func syncopeTestModel() *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "foundation.opensphere.io/v1alpha1", "kind": "FoundationModel",
		"metadata": map[string]interface{}{"name": "identity"},
		"spec": map[string]interface{}{"parameters": map[string]interface{}{
			"engines":         map[string]interface{}{"syncope": "enabled"},
			"identityEngines": map[string]interface{}{"syncope": map[string]interface{}{"version": "4.0.6", "replicas": int64(1)}},
		}},
	}}
}

func TestBuildSyncopeBundlePinsSafeVersionAndProductionFloor(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", syncopeImage: "ghcr.io/opensphere-platform/mirror/syncope@sha256:970ece", syncopeMonitorImage: "ghcr.io/opensphere-platform/foundation-control-plane@sha256:monitor"}
	objects, err := buildSyncopeBundle(cfg, syncopeTestModel())
	if err != nil {
		t.Fatal(err)
	}
	var statefulSet *unstructured.Unstructured
	var serviceMonitor *unstructured.Unstructured
	for _, object := range objects {
		switch object.GetKind() {
		case "StatefulSet":
			statefulSet = object
		case "ServiceMonitor":
			serviceMonitor = object
		}
	}
	if statefulSet == nil || serviceMonitor == nil {
		t.Fatalf("production resources missing: StatefulSet=%v ServiceMonitor=%v", statefulSet != nil, serviceMonitor != nil)
	}
	replicas, _, _ := unstructured.NestedInt64(statefulSet.Object, "spec", "replicas")
	if replicas != 2 {
		t.Fatalf("replica floor not applied: %d", replicas)
	}
	containers, _, _ := unstructured.NestedSlice(statefulSet.Object, "spec", "template", "spec", "containers")
	core := containers[0].(map[string]interface{})
	if core["image"] != cfg.syncopeImage {
		t.Fatalf("exact Syncope digest was modified: %v", core["image"])
	}
	monitor := containers[1].(map[string]interface{})
	if monitor["image"] != cfg.syncopeMonitorImage {
		t.Fatalf("monitor exact digest missing: %v", monitor["image"])
	}
	endpoints, _, _ := unstructured.NestedSlice(serviceMonitor.Object, "spec", "endpoints")
	if endpoints[0].(map[string]interface{})["interval"] != "15s" {
		t.Fatalf("unexpected scrape interval: %v", endpoints[0])
	}
}

func TestSyncopeRemainsExplicitOptIn(t *testing.T) {
	fm := syncopeTestModel()
	unstructured.RemoveNestedField(fm.Object, "spec", "parameters", "engines", "syncope")
	if syncopeExplicitlyEnabled(fm) {
		t.Fatal("Syncope must not be installed by an upgrade without explicit opt-in")
	}
}
