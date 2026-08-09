package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLiteLLMSessionGeneratesScopedVirtualKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/key/generate" || request.Method != http.MethodPost {
			http.NotFound(w, request)
			return
		}
		if request.Header.Get("authorization") != "Bearer sk-master-123456789012345678901234567890" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var payload map[string]interface{}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		encoded, _ := json.Marshal(payload)
		text := string(encoded)
		for _, expected := range []string{`"key_alias":"opensphere:tenant-a/chat-access"`, `"models":["gpt-4o-mini"]`, `"claim_uid":"claim-uid"`} {
			if !strings.Contains(text, expected) {
				t.Errorf("key request is missing %s: %s", expected, text)
			}
		}
		w.Header().Set("content-type", "application/json")
		w.Write([]byte(`{"key":"sk-virtual-123","token_id":"token-hash"}`))
	}))
	defer server.Close()
	claim := stalwartTestClaim("Access", map[string]interface{}{"models": []interface{}{"gpt-4o-mini"}})
	claim.SetName("chat-access")
	claim.SetUID("claim-uid")
	session := &liteLLMSession{baseURL: server.URL, masterKey: "sk-master-123456789012345678901234567890", client: server.Client()}
	key, tokenID, err := session.generateKey(context.Background(), claim, []string{"gpt-4o-mini"})
	if err != nil || key != "sk-virtual-123" || tokenID != "token-hash" {
		t.Fatalf("generated key=%q token=%q err=%v", key, tokenID, err)
	}
}

func TestLiteLLMSessionChecksAndDeletesExactKey(t *testing.T) {
	seenInfo, seenDelete := false, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/key/info":
			seenInfo = request.URL.Query().Get("key") == "sk-exact"
			w.Write([]byte(`{"key":"sk-exact"}`))
		case "/key/delete":
			seenDelete = true
			var payload map[string]interface{}
			_ = json.NewDecoder(request.Body).Decode(&payload)
			encoded, _ := json.Marshal(payload)
			if !strings.Contains(string(encoded), `"keys":["sk-exact"]`) {
				t.Errorf("delete payload=%s", encoded)
			}
			w.Write([]byte(`{"deleted_keys":["sk-exact"]}`))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	session := &liteLLMSession{baseURL: server.URL, masterKey: "sk-master", client: server.Client()}
	exists, err := session.keyExists(context.Background(), "sk-exact")
	if err != nil || !exists {
		t.Fatalf("key exists=%v err=%v", exists, err)
	}
	if err := session.deleteKey(context.Background(), "sk-exact"); err != nil {
		t.Fatal(err)
	}
	if !seenInfo || !seenDelete {
		t.Fatalf("info=%v delete=%v", seenInfo, seenDelete)
	}
}

func TestLiteLLMRouteLifecycleUsesOwnedOfficialModelEndpoints(t *testing.T) {
	claim := stalwartTestClaim("Route", map[string]interface{}{})
	claim.SetName("chat-route")
	claim.SetUID("route-uid")
	listCalls, createCalls, updateCalls, deleteCalls := 0, 0, 0, 0
	created := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("authorization") != "Bearer sk-master" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v1/model/info":
			listCalls++
			if !created {
				w.Write([]byte(`{"data":[]}`))
				return
			}
			w.Write([]byte(`{"data":[{"model_id":"model-1","model_name":"chat","model_info":{"opensphere_managed":true,"opensphere_claim_namespace":"tenant-a","opensphere_claim_name":"chat-route","opensphere_claim_uid":"route-uid","opensphere_spec_hash":"old"}}]}`))
		case request.Method == http.MethodPost && request.URL.Path == "/model/new":
			createCalls++
			created = true
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"model_id":"model-1"}`))
		case request.Method == http.MethodPatch && request.URL.Path == "/model/model-1/update":
			updateCalls++
			w.Write([]byte(`{"model_id":"model-1"}`))
		case request.Method == http.MethodPost && request.URL.Path == "/model/delete":
			deleteCalls++
			w.Write([]byte(`{"deleted":true}`))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	session := &liteLLMSession{baseURL: server.URL, masterKey: "sk-master", client: server.Client()}
	params := map[string]interface{}{"model": "openai/gpt-4o-mini", "api_key": "provider-secret"}
	info := map[string]interface{}{
		"opensphere_managed": true, "opensphere_claim_namespace": "tenant-a", "opensphere_claim_name": "chat-route",
		"opensphere_claim_uid": "route-uid", "opensphere_spec_hash": "desired",
	}
	id, reason, err := session.ensureRoute(context.Background(), claim, "chat", params, info)
	if err != nil || reason != "" || id != "model-1" || createCalls != 1 {
		t.Fatalf("create id=%q reason=%q err=%v calls=%d", id, reason, err, createCalls)
	}
	id, reason, err = session.ensureRoute(context.Background(), claim, "chat", params, info)
	if err != nil || reason != "" || id != "model-1" || updateCalls != 1 {
		t.Fatalf("update id=%q reason=%q err=%v calls=%d", id, reason, err, updateCalls)
	}
	if err := session.deleteRoute(context.Background(), "model-1"); err != nil || deleteCalls != 1 {
		t.Fatalf("delete err=%v calls=%d", err, deleteCalls)
	}
	if listCalls < 2 {
		t.Fatalf("list calls=%d", listCalls)
	}
}

func TestLiteLLMRouteRefusesForeignModelName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Write([]byte(`{"data":[{"model_id":"foreign","model_name":"chat","model_info":{"team":"other"}}]}`))
	}))
	defer server.Close()
	claim := stalwartTestClaim("Route", nil)
	claim.SetName("chat-route")
	session := &liteLLMSession{baseURL: server.URL, masterKey: "sk-master", client: server.Client()}
	_, reason, err := session.ensureRoute(context.Background(), claim, "chat", map[string]interface{}{"model": "openai/gpt-4o"}, map[string]interface{}{"opensphere_spec_hash": "hash"})
	if err != nil || reason != "LiteLLMRouteOwnershipConflict" {
		t.Fatalf("reason=%q err=%v", reason, err)
	}
}

func TestLiteLLMRouteSpecMergesProviderSecretWithoutAcceptingInlineSecret(t *testing.T) {
	claim := stalwartTestClaim("Route", map[string]interface{}{
		"modelName": "chat", "providerModel": "openai/gpt-4o-mini", "litellmParams": map[string]interface{}{"timeout": float64(30)},
	})
	claim.SetName("chat-route")
	claim.SetUID("route-uid")
	credential := object(coreSecretGVK, "tenant-a", "provider")
	credential.Object["stringData"] = map[string]interface{}{"api_key": "provider-key", "api_base": "https://provider.example"}
	name, params, info, reason := liteLLMRouteSpec(claim, credential)
	if reason != "" || name != "chat" || params["api_key"] != "provider-key" || params["model"] != "openai/gpt-4o-mini" {
		t.Fatalf("name=%q params=%v info=%v reason=%q", name, params, info, reason)
	}
	if cleanInterfaceString(info["opensphere_spec_hash"]) == "" || !routeOwnedByClaim(liteLLMRouteRecord{ModelInfo: info}, claim) {
		t.Fatalf("ownership info=%v", info)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"].(map[string]interface{})["litellmParams"].(map[string]interface{})["api_key"] = "inline"
	_, _, _, reason = liteLLMRouteSpec(claim, credential)
	if reason != "LiteLLMRouteSecretMustUseCredentialRef" {
		t.Fatalf("reason=%q", reason)
	}
}

func TestLiteLLMAccessAndRouteCatalogAreManaged(t *testing.T) {
	contract, _ := serviceContract("litellm")
	if contract.requestMode("Access") != "managed" || !contract.requestReady("Access") {
		t.Fatal("LiteLLM Access must provision a scoped virtual key")
	}
	if contract.requestMode("Route") != "managed" || !contract.requestReady("Route") {
		t.Fatal("LiteLLM Route must manage an owned provider model route")
	}
}
