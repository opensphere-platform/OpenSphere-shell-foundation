package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func novuTestWorkflowClaim() *unstructured.Unstructured {
	claim := stalwartTestClaim("Workflow", map[string]interface{}{
		"workflow": map[string]interface{}{
			"workflowId": "order-ready",
			"name":       "Order ready",
			"steps": []interface{}{map[string]interface{}{
				"name": "Inbox", "stepId": "inbox", "type": "in_app", "controlValues": map[string]interface{}{"body": "Ready"},
			}},
			"tags": []interface{}{"business:orders"},
		},
	})
	claim.SetName("order-ready-claim")
	claim.SetNamespace("tenant-a")
	claim.SetUID("claim-uid")
	return claim
}

func TestNovuWorkflowSpecAddsStableOwnershipTags(t *testing.T) {
	claim := novuTestWorkflowClaim()
	id, workflow, valid := novuWorkflowSpec(claim)
	if !valid || id != "order-ready" {
		t.Fatalf("id=%q valid=%v", id, valid)
	}
	tags := stringSlice(workflow["tags"])
	for _, expected := range []string{"business:orders", "opensphere-managed", "opensphere-claim-namespace:tenant-a", "opensphere-claim-name:order-ready-claim"} {
		if !containsAll(tags, []string{expected}) {
			t.Fatalf("missing tag %q in %#v", expected, tags)
		}
	}
}

func TestNovuSessionCreatesAndUpdatesOnlyOwnedWorkflow(t *testing.T) {
	claim := novuTestWorkflowClaim()
	_, workflow, _ := novuWorkflowSpec(claim)
	created := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "ApiKey secret-value" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v2/workflows/order-ready" && !created:
			http.NotFound(w, request)
		case request.Method == http.MethodPost && request.URL.Path == "/v2/workflows":
			if request.Header.Get("idempotency-key") != "foundation-claim-claim-uid" {
				t.Errorf("idempotency key=%q", request.Header.Get("idempotency-key"))
			}
			created = true
			w.WriteHeader(http.StatusCreated)
		case request.Method == http.MethodGet && request.URL.Path == "/v2/workflows/order-ready" && created:
			json.NewEncoder(w).Encode(map[string]interface{}{"workflowId": "order-ready", "tags": novuOwnerTags(claim)})
		case request.Method == http.MethodPut && request.URL.Path == "/v2/workflows/order-ready":
			var payload map[string]interface{}
			_ = json.NewDecoder(request.Body).Decode(&payload)
			if !containsAll(stringSlice(payload["tags"]), novuOwnerTags(claim)) {
				t.Errorf("update lost ownership tags: %#v", payload["tags"])
			}
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	session := &novuSession{baseURL: server.URL, apiKey: "secret-value", client: server.Client()}
	if reason, err := session.upsertWorkflow(context.Background(), claim, "order-ready", workflow); err != nil || reason != "" {
		t.Fatalf("create reason=%q err=%v", reason, err)
	}
	if reason, err := session.upsertWorkflow(context.Background(), claim, "order-ready", workflow); err != nil || reason != "" {
		t.Fatalf("update reason=%q err=%v", reason, err)
	}
}

func TestNovuSessionRefusesForeignWorkflowMutation(t *testing.T) {
	claim := novuTestWorkflowClaim()
	_, workflow, _ := novuWorkflowSpec(claim)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{"workflowId": "order-ready", "tags": []string{"owner:someone-else"}})
	}))
	defer server.Close()
	session := &novuSession{baseURL: server.URL, apiKey: "secret-value", client: server.Client()}
	reason, err := session.upsertWorkflow(context.Background(), claim, "order-ready", workflow)
	if err != nil || reason != "NovuWorkflowOwnershipConflict" {
		t.Fatalf("reason=%q err=%v", reason, err)
	}
}

func TestNovuCatalogExposesManagedWorkflowAndExistingAccess(t *testing.T) {
	contract, _ := serviceContract("novu")
	if contract.requestMode("Workflow") != "managed" || !contract.requestReady("Workflow") {
		t.Fatal("Novu Workflow must use the product API operator")
	}
	if contract.requestMode("Access") != "bind-existing" || !contract.requestReady("Access") {
		t.Fatal("Novu Access must validate an environment-specific secret without copying the platform admin key")
	}
	if strings.Contains(strings.Join(contract.Capabilities, ","), "fake") {
		t.Fatal("catalog must not advertise placeholder capabilities")
	}
}
