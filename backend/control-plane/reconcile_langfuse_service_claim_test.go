package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLangfuseBundleDeclaresIdempotentHeadlessProject(t *testing.T) {
	cfg := &config{managedNS: "foundation", langfuseImage: "langfuse", langfuseWorkerImage: "worker", clickhouseImage: "clickhouse", defaultStorageClass: "standard"}
	objects, err := buildAIBundle(cfg, aiTestModel(map[string]interface{}{"litellm": "disabled", "langfuse": "enabled"}))
	if err != nil {
		t.Fatal(err)
	}
	deployment := findAIObject(objects, "Deployment", langfuseName)
	if deployment == nil {
		t.Fatal("Langfuse Deployment is missing")
	}
	encoded, _ := json.Marshal(deployment.Object)
	text := string(encoded)
	for _, key := range []string{"LANGFUSE_INIT_ORG_ID", "LANGFUSE_INIT_PROJECT_ID", "LANGFUSE_INIT_PROJECT_PUBLIC_KEY", "LANGFUSE_INIT_PROJECT_SECRET_KEY"} {
		if !strings.Contains(text, key) || !strings.Contains(text, aiRuntimeSecret) {
			t.Errorf("Langfuse headless bootstrap is missing %s: %s", key, text)
		}
	}
}

func TestLangfuseCatalogExposesOnlySharedOSSProject(t *testing.T) {
	contract, _ := serviceContract("langfuse")
	if contract.requestMode("Project") != "bind-shared" || !contract.requestReady("Project") {
		t.Fatal("Langfuse Project must bind to the headless-initialized OSS project")
	}
	if contract.requestMode("Access") != "managed" || !contract.requestReady("Access") {
		t.Fatal("Langfuse Access must project the scoped project API key")
	}
}

func TestLangfuseCredentialNameIsDNSBounded(t *testing.T) {
	claim := gvkObj(fcGVK)
	claim.SetName(strings.Repeat("a", 63))
	name := langfuseCredentialName(claim)
	if len(name) > 63 || strings.HasSuffix(name, "-") {
		t.Fatalf("credential name=%q", name)
	}
}
