package main

import (
	"strings"
	"testing"
)

func TestGrafanaDashboardRequiresValidDeclarativeSource(t *testing.T) {
	claim := stalwartTestClaim("Dashboard", map[string]interface{}{
		"json": map[string]interface{}{"title": "Platform health", "panels": []interface{}{}},
	})
	payload, reason := grafanaDashboardPayload(claim)
	if reason != "" || !strings.Contains(payload["json"].(string), "Platform health") {
		t.Fatalf("payload=%v reason=%q", payload, reason)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"] = map[string]interface{}{"json": map[string]interface{}{"panels": []interface{}{}}}
	if _, reason = grafanaDashboardPayload(claim); reason != "GrafanaDashboardTitleInvalid" {
		t.Fatalf("untitled dashboard accepted: %q", reason)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"] = map[string]interface{}{"grafanaCom": map[string]interface{}{"id": "1860", "revision": "37"}}
	if payload, reason = grafanaDashboardPayload(claim); reason != "" || payload["grafanaCom"] == nil {
		t.Fatalf("catalog payload=%v reason=%q", payload, reason)
	}
}

func TestGrafanaDatasourceUsesSecretSubstitutionAndRejectsInlineSecrets(t *testing.T) {
	claim := stalwartTestClaim("DataSource", map[string]interface{}{
		"name": "Tenant Loki", "type": "loki", "url": "http://loki.svc:3100", "auth": "bearer", "isDefault": true,
	})
	claim.Object["spec"].(map[string]interface{})["credentialSecretRef"] = map[string]interface{}{"name": "loki-token"}
	datasource, valuesFrom, reason := grafanaDatasourceSpec(claim)
	if reason != "" || len(valuesFrom) != 1 {
		t.Fatalf("datasource=%v valuesFrom=%v reason=%q", datasource, valuesFrom, reason)
	}
	if datasource["isDefault"] != true {
		t.Fatalf("boolean isDefault was not preserved: %v", datasource["isDefault"])
	}
	secure := datasource["secureJsonData"].(map[string]interface{})
	if secure["httpHeaderValue1"] != "Bearer ${GRAFANA_TOKEN}" {
		t.Fatalf("secret substitution missing: %v", secure)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"].(map[string]interface{})["secureJsonData"] = map[string]interface{}{"password": "inline"}
	if _, _, reason = grafanaDatasourceSpec(claim); reason != "GrafanaDatasourceInlineSecretRejected" {
		t.Fatalf("inline secret accepted: %q", reason)
	}
}

func TestGrafanaClaimResourcesAreNamespaceStableAndOwned(t *testing.T) {
	first := stalwartTestClaim("Access", nil)
	first.SetName("dashboard-reader")
	first.SetUID("uid-a")
	second := first.DeepCopy()
	second.SetNamespace("tenant-b")
	if grafanaClaimResourceName(first, "access") == grafanaClaimResourceName(second, "access") {
		t.Fatal("consumer namespaces must not collide")
	}
	resource := object(grafanaServiceAccountGVK, "opensphere-foundation", grafanaClaimResourceName(first, "access"))
	stampGrafanaClaimOwnership(resource, first)
	if !grafanaClaimOwned(resource, first) || grafanaClaimOwned(resource, second) {
		t.Fatalf("ownership labels=%v", resource.GetLabels())
	}
}

func TestGrafanaSynchronizedRequiresCurrentSuccessfulCondition(t *testing.T) {
	resource := object(grafanaDashboardGVK, "tenant-a", "dashboard")
	resource.SetGeneration(2)
	resource.Object["status"] = map[string]interface{}{"conditions": []interface{}{map[string]interface{}{
		"type": "DashboardSynchronized", "status": "True", "reason": "ApplySuccessful", "observedGeneration": int64(2),
	}}}
	ready, failed := grafanaSynchronized(resource, "DashboardSynchronized")
	if !ready || failed {
		t.Fatalf("ready=%v failed=%v", ready, failed)
	}
	resource.Object["status"].(map[string]interface{})["conditions"].([]interface{})[0].(map[string]interface{})["observedGeneration"] = int64(1)
	ready, failed = grafanaSynchronized(resource, "DashboardSynchronized")
	if ready || failed {
		t.Fatalf("stale condition ready=%v failed=%v", ready, failed)
	}
}
