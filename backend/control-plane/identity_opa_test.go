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

func TestOPABundleIsFailClosedAndMonitored(t *testing.T) {
	fm := opaFoundationModel("enabled")
	cfg := &config{managedNS: "opensphere-foundation", opaImage: "ghcr.io/opensphere-platform/mirror/opa@sha256:3ece20d3a58eb4051db71c0b84fc962bca2a6f9aa74ee8ea3d027d693fdc2d1a"}
	objs, err := buildOPABundle(cfg, fm)
	if err != nil {
		t.Fatal(err)
	}
	foundDeployment, foundMonitor, foundPolicy := false, false, false
	for _, obj := range objs {
		if obj.GetLabels()[lblEngine] != "opa" {
			t.Fatalf("%s/%s missing OPA engine label", obj.GetKind(), obj.GetName())
		}
		switch obj.GetKind() {
		case "Deployment":
			foundDeployment = true
		case "ServiceMonitor":
			foundMonitor = true
			endpoints, _, _ := unstructured.NestedSlice(obj.Object, "spec", "endpoints")
			endpoint := endpoints[0].(map[string]interface{})
			if endpoint["port"] != "diagnostic" || endpoint["path"] != "/metrics" || endpoint["interval"] != "15s" {
				t.Fatalf("unexpected OPA ServiceMonitor endpoint: %#v", endpoint)
			}
		case "ConfigMap":
			data, _, _ := unstructured.NestedStringMap(obj.Object, "data")
			foundPolicy = strings.Contains(data["bootstrap.rego"], "default allow := false") && strings.Contains(data["system-authz.rego"], "input.method == \"POST\"") && strings.Contains(data["system-authz.rego"], "input.path in [[\"health\"], [\"metrics\"]]")
		}
	}
	if !foundDeployment || !foundMonitor || !foundPolicy {
		t.Fatalf("OPA bundle incomplete: deployment=%v monitor=%v failClosedPolicy=%v", foundDeployment, foundMonitor, foundPolicy)
	}
}
