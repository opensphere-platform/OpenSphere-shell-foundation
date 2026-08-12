package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestGrafanaBundleUsesOperatorCRAndCanonicalOperandMirror(t *testing.T) {
	cfg := &config{
		managedNS: "opensphere-foundation", defaultStorageClass: "standard",
		grafanaImage: "ghcr.io/opensphere-platform/mirror/grafana@sha256:operand",
	}
	fm := &unstructured.Unstructured{Object: map[string]interface{}{"metadata": map[string]interface{}{"name": "observability"}}}
	objects := buildGrafanaBundle(cfg, fm)
	if len(objects) != 1 || objects[0].GetKind() != "Grafana" {
		t.Fatalf("expected one Grafana CR, got %#v", objects)
	}
	grafana := objects[0]
	version, _, _ := unstructured.NestedString(grafana.Object, "spec", "version")
	if version != cfg.grafanaImage || strings.Contains(version, "grafana-operator") {
		t.Fatalf("Grafana operand image=%q", version)
	}
	if _, found, _ := unstructured.NestedString(grafana.Object, "spec", "config", "security", "admin_password"); found {
		t.Fatal("admin password must never be embedded in the Grafana CR")
	}
	storageClass, _, _ := unstructured.NestedString(grafana.Object, "spec", "persistentVolumeClaim", "spec", "storageClassName")
	if storageClass != "standard" {
		t.Fatalf("storageClass=%q", storageClass)
	}
	volumes, found, err := unstructured.NestedSlice(grafana.Object, "spec", "deployment", "spec", "template", "spec", "volumes")
	if err != nil || !found || len(volumes) != 1 {
		t.Fatalf("grafana volumes=%#v found=%v err=%v", volumes, found, err)
	}
	volume, ok := volumes[0].(map[string]interface{})
	if !ok || volume["name"] != "grafana-data" {
		t.Fatalf("grafana data volume=%#v", volumes[0])
	}
	pvc, ok := volume["persistentVolumeClaim"].(map[string]interface{})
	if !ok || pvc["claimName"] != grafanaName+"-pvc" {
		t.Fatalf("grafana data PVC=%#v", volume["persistentVolumeClaim"])
	}
	selector := grafana.GetLabels()[grafanaSelectorKey]
	if selector != grafanaSelectorValue {
		t.Fatalf("cross-namespace content selector label=%q", selector)
	}
}

func TestGrafanaReadinessRequiresSuccessfulCurrentInstance(t *testing.T) {
	grafana := object(grafanaGVK, "opensphere-foundation", grafanaName)
	grafana.Object["status"] = map[string]interface{}{
		"stage": "complete", "stageStatus": "success",
		"conditions": []interface{}{map[string]interface{}{"type": "GrafanaReady", "status": "True"}},
	}
	if !grafanaObjectReady(grafana) {
		t.Fatal("successful Grafana instance was not ready")
	}
	grafana.Object["status"].(map[string]interface{})["stageStatus"] = "failed"
	if grafanaObjectReady(grafana) {
		t.Fatal("failed Grafana instance reported ready")
	}
	grafana.Object["status"].(map[string]interface{})["stageStatus"] = "success"
	grafana.Object["status"].(map[string]interface{})["conditions"] = []interface{}{map[string]interface{}{"type": "GrafanaReady", "status": "False"}}
	if grafanaObjectReady(grafana) {
		t.Fatal("GrafanaReady=False reported ready")
	}
}
