package main

import (
	"encoding/json"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func aiTestModel(engines map[string]interface{}) *unstructured.Unstructured {
	fm := gvkObj(fmGVK)
	fm.SetName("ai")
	fm.Object["spec"] = map[string]interface{}{"model": "ai", "parameters": map[string]interface{}{"engines": engines}}
	return fm
}

func findAIObject(objects []*unstructured.Unstructured, kind, name string) *unstructured.Unstructured {
	for _, object := range objects {
		if object.GetKind() == kind && object.GetName() == name {
			return object
		}
	}
	return nil
}

func TestAIBundleHonorsExplicitEngineDisable(t *testing.T) {
	objects, err := buildAIBundle(&config{managedNS: "foundation"}, aiTestModel(map[string]interface{}{"litellm": "disabled", "langfuse": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 0 {
		t.Fatalf("disabled AI engines rendered %d objects", len(objects))
	}
}

func TestLiteLLMBundleUsesDedicatedPostgresAndExactSecret(t *testing.T) {
	cfg := &config{managedNS: "foundation", litellmImage: "mirror/litellm@sha256:exact"}
	objects, err := buildAIBundle(cfg, aiTestModel(map[string]interface{}{"litellm": "enabled", "langfuse": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	claim := findAIObject(objects, "PostgresClaim", liteLLMPostgresClaim)
	if claim == nil || claim.GetLabels()[lblEngine] != "litellm" {
		t.Fatal("LiteLLM dedicated PostgresClaim ownership is missing")
	}
	deployment := findAIObject(objects, "Deployment", liteLLMName)
	if deployment == nil {
		t.Fatal("LiteLLM Deployment is missing")
	}
	containers, _, _ := unstructured.NestedSlice(deployment.Object, "spec", "template", "spec", "containers")
	rendered := strings.ToLower(toJSON(containers))
	if strings.Contains(rendered, "password\"") || !strings.Contains(rendered, aiRuntimeSecret) || !strings.Contains(rendered, liteLLMPostgresClaim+"-binding") {
		t.Fatalf("LiteLLM credentials must be exact Secret references: %s", rendered)
	}
}

func TestLangfuseBundleConsumesScopedValkeyAndRustFSClaims(t *testing.T) {
	cfg := &config{managedNS: "foundation", langfuseImage: "langfuse", langfuseWorkerImage: "worker", clickhouseImage: "clickhouse", defaultStorageClass: "standard"}
	objects, err := buildAIBundle(cfg, aiTestModel(map[string]interface{}{"litellm": "disabled", "langfuse": "enabled"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{langfuseValkeyClaim, langfuseBucketClaim, langfuseAccessClaim} {
		claim := findAIObject(objects, "FoundationClaim", name)
		if claim == nil || claim.GetLabels()[lblEngine] != "langfuse" {
			t.Fatalf("scoped Langfuse dependency %s is missing", name)
		}
	}
	web := findAIObject(objects, "Deployment", langfuseName)
	if web == nil {
		t.Fatal("Langfuse web Deployment is missing")
	}
	rendered := toJSON(web.Object)
	for _, secret := range []string{aiRuntimeSecret, langfuseValkeyClaim + valkeyCredentialSuffix, langfuseAccessClaim + rustFSCredentialSuffix, langfusePostgresClaim + "-binding"} {
		if !strings.Contains(rendered, secret) {
			t.Fatalf("Langfuse workload does not reference scoped Secret %s", secret)
		}
	}
	if strings.Contains(rendered, rustfsDefaultAuthSecret) || strings.Contains(rendered, valkeyDefaultAuthSecret) {
		t.Fatal("Langfuse workload leaked a data-engine root credential")
	}
}

func toJSON(value interface{}) string {
	rendered, _ := json.Marshal(value)
	return string(rendered)
}
