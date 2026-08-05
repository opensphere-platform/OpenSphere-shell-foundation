package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func opaFoundationModel(enabled string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "foundation.opensphere.io/v1alpha1",
		"kind":       "FoundationModel",
		"metadata":   map[string]interface{}{"name": "identity"},
		"spec": map[string]interface{}{
			"model": "identity",
			"parameters": map[string]interface{}{
				"engines": map[string]interface{}{"keycloak": "disabled", "samba": "disabled", "opa": enabled},
			},
		},
	}}
}

func TestOPAIsExplicitOptIn(t *testing.T) {
	fm := opaFoundationModel("disabled")
	if opaExplicitlyEnabled(fm) {
		t.Fatal("OPA must stay disabled until engines.opa=enabled")
	}
	unstructured.RemoveNestedField(fm.Object, "spec", "parameters", "engines", "opa")
	if opaExplicitlyEnabled(fm) {
		t.Fatal("OPA must not be enabled when engines.opa is absent")
	}
}

func TestOPABundleIsProductionFailClosedAndMonitored(t *testing.T) {
	fm := opaFoundationModel("enabled")
	cfg := &config{managedNS: "opensphere-foundation", opaImage: "ghcr.io/opensphere-platform/mirror/opa@sha256:3ece20d3a58eb4051db71c0b84fc962bca2a6f9aa74ee8ea3d027d693fdc2d1a", opaControlImage: "ghcr.io/opensphere-platform/opensphere-foundation-control-plane@sha256:test"}
	objs, err := buildOPABundle(cfg, fm)
	if err != nil {
		t.Fatal(err)
	}
	foundOPA, foundControl, foundMonitor, foundPolicy, foundPDB, foundCertificate, foundRule := false, false, false, false, false, false, false
	for _, obj := range objs {
		if obj.GetLabels()[lblEngine] != "opa" {
			t.Fatalf("%s/%s missing OPA engine label", obj.GetKind(), obj.GetName())
		}
		switch obj.GetKind() {
		case "Deployment":
			if obj.GetName() == opaName {
				foundOPA = true
				replicas, _, _ := unstructured.NestedInt64(obj.Object, "spec", "replicas")
				if replicas != 2 {
					t.Fatalf("production OPA must have two replicas, got %d", replicas)
				}
			}
			if obj.GetName() == opaControlName {
				foundControl = true
			}
		case "ServiceMonitor":
			foundMonitor = true
			if obj.GetName() == opaName {
				endpoints, _, _ := unstructured.NestedSlice(obj.Object, "spec", "endpoints")
				endpoint := endpoints[0].(map[string]interface{})
				if endpoint["port"] != "diagnostic" || endpoint["path"] != "/metrics" || endpoint["interval"] != "15s" {
					t.Fatalf("unexpected OPA ServiceMonitor endpoint: %#v", endpoint)
				}
			}
		case "ConfigMap":
			data, _, _ := unstructured.NestedStringMap(obj.Object, "data")
			foundPolicy = strings.Contains(data["config.yaml"], "signing:") && strings.Contains(data["config.yaml"], "opensphere-opa-edge-bundle-v1") && strings.Contains(data["config.yaml"], "decision_logs:")
		case "PodDisruptionBudget":
			foundPDB = true
		case "Certificate":
			foundCertificate = true
		case "PrometheusRule":
			foundRule = true
		}
	}
	if !foundOPA || !foundControl || !foundMonitor || !foundPolicy || !foundPDB || !foundCertificate || !foundRule {
		t.Fatalf("OPA production bundle incomplete: opa=%v control=%v monitor=%v signedPolicy=%v pdb=%v cert=%v rule=%v", foundOPA, foundControl, foundMonitor, foundPolicy, foundPDB, foundCertificate, foundRule)
	}
}
