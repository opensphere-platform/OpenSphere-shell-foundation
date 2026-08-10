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

func TestKeycloakAdminSessionReconcilesRealmAndClientIdempotently(t *testing.T) {
	realmExists, clientExists := false, false
	realmCreates, realmUpdates, clientCreates, clientUpdates := 0, 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "Bearer token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/app":
			if !realmExists {
				http.NotFound(w, r)
				return
			}
			w.Write([]byte(`{"realm":"app"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/admin/realms":
			realmExists, realmCreates = true, realmCreates+1
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPut && r.URL.Path == "/admin/realms/app":
			realmUpdates++
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/app/clients":
			if clientExists {
				w.Write([]byte(`[{"id":"internal-1","clientId":"orders"}]`))
			} else {
				w.Write([]byte(`[]`))
			}
		case r.Method == http.MethodPost && r.URL.Path == "/admin/realms/app/clients":
			clientExists, clientCreates = true, clientCreates+1
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPut && r.URL.Path == "/admin/realms/app/clients/internal-1":
			clientUpdates++
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/app/clients/internal-1/client-secret":
			w.Write([]byte(`{"value":"client-secret"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	session := &keycloakAdminSession{baseURL: server.URL, token: "token", client: server.Client()}
	ctx := context.Background()
	realmPayload := map[string]interface{}{"realm": "app", "enabled": true}
	if err := session.ensureRealm(ctx, "app", realmPayload); err != nil {
		t.Fatal(err)
	}
	if err := session.ensureRealm(ctx, "app", realmPayload); err != nil {
		t.Fatal(err)
	}
	clientPayload := map[string]interface{}{"clientId": "orders", "enabled": true}
	id, found, err := session.findClient(ctx, "app", "orders")
	if err != nil || found {
		t.Fatalf("initial client lookup = %q/%v/%v", id, found, err)
	}
	id, err = session.ensureClient(ctx, "app", id, found, clientPayload)
	if err != nil || id != "internal-1" {
		t.Fatalf("client create = %q/%v", id, err)
	}
	id, found, err = session.findClient(ctx, "app", "orders")
	if err != nil || !found {
		t.Fatalf("reconciled client lookup = %q/%v/%v", id, found, err)
	}
	if _, err := session.ensureClient(ctx, "app", id, found, clientPayload); err != nil {
		t.Fatal(err)
	}
	secret, err := session.clientSecret(ctx, "app", id)
	if err != nil || secret != "client-secret" {
		t.Fatalf("client secret = %q/%v", secret, err)
	}
	if realmCreates != 1 || realmUpdates != 1 || clientCreates != 1 || clientUpdates != 1 {
		t.Fatalf("unexpected lifecycle calls realm=%d/%d client=%d/%d", realmCreates, realmUpdates, clientCreates, clientUpdates)
	}
}

func TestKeycloakClientPayloadDefaultsToConfidentialServiceAccount(t *testing.T) {
	claim := gvkObj(fcGVK)
	claim.SetName("orders")
	claim.Object["spec"] = map[string]interface{}{"parameters": map[string]interface{}{}}
	payload := keycloakClientPayload(claim, "orders")
	encoded, _ := json.Marshal(payload)
	text := string(encoded)
	for _, expected := range []string{`"publicClient":false`, `"serviceAccountsEnabled":true`, `"directAccessGrantsEnabled":false`, `"pkce.code.challenge.method":"S256"`} {
		if !strings.Contains(text, expected) {
			t.Errorf("client payload is missing %s: %s", expected, text)
		}
	}
}

func TestKeycloakBundleUsesManagedPostgresAndExternalAdminSecret(t *testing.T) {
	fm := gvkObj(fmGVK)
	fm.SetName("identity")
	fm.Object["spec"] = map[string]interface{}{"parameters": map[string]interface{}{"engines": map[string]interface{}{"keycloak": "enabled", "samba": "disabled", "opa": "disabled", "syncope": "disabled"}}}
	objects, err := buildIdentityBundle(&config{managedNS: "opensphere-foundation", keycloakImage: "mirror/keycloak:26.0"}, fm)
	if err != nil {
		t.Fatal(err)
	}
	seenClaim, seenRealm, seenDeployment := false, false, false
	for _, object := range objects {
		if object.GetKind() == "PostgresClaim" && object.GetName() == "foundation-identity-keycloak-pg" {
			seenClaim = true
		}
		if object.GetKind() == "ConfigMap" && object.GetName() == "keycloak-realm-import" {
			seenRealm = true
			data, _, _ := unstructured.NestedStringMap(object.Object, "data")
			if !strings.Contains(data["opensphere-workforce-realm.json"], `"realm": "opensphere-workforce"`) {
				t.Fatalf("Keycloak bootstrap realm is missing: %#v", data)
			}
		}
		if object.GetKind() != "Deployment" || object.GetName() != keycloakName {
			continue
		}
		seenDeployment = true
		containers, _, _ := unstructured.NestedSlice(object.Object, "spec", "template", "spec", "containers")
		encoded, _ := json.Marshal(containers[0])
		text := string(encoded)
		for _, expected := range []string{`"start"`, "KC_DB_URL", "pgc-foundation-identity-keycloak-pg-binding", keycloakAdminSecretName, `"containerPort":9000`, `"path":"/health/started"`, `"path":"/health/ready"`, `"path":"/health/live"`} {
			if !strings.Contains(text, expected) {
				t.Errorf("Keycloak deployment is missing %q: %s", expected, text)
			}
		}
		volumes, _, _ := unstructured.NestedSlice(object.Object, "spec", "template", "spec", "volumes")
		volumeJSON, _ := json.Marshal(volumes)
		if !strings.Contains(string(volumeJSON), `"name":"keycloak-realm-import","optional":false`) {
			t.Fatalf("Keycloak realm ConfigMap must be required: %s", volumeJSON)
		}
		if strings.Contains(text, "start-dev") || strings.Contains(text, "embedded-h2") {
			t.Fatalf("development Keycloak mode leaked into production bundle: %s", text)
		}
	}
	if !seenClaim || !seenRealm || !seenDeployment {
		t.Fatalf("bundle missing claim=%v realm=%v deployment=%v", seenClaim, seenRealm, seenDeployment)
	}
}

func TestKeycloakBundleAppliesSelectedPostgresPlan(t *testing.T) {
	fm := gvkObj(fmGVK)
	fm.SetName("identity")
	fm.Object["spec"] = map[string]interface{}{"parameters": map[string]interface{}{
		"engines": map[string]interface{}{"keycloak": "enabled", "samba": "disabled", "opa": "disabled", "syncope": "disabled"},
		"identityEngines": map[string]interface{}{"keycloak": map[string]interface{}{
			"databaseMode": "managed-postgres", "databasePlan": "postgresql-prod-ha-pitr",
		}},
	}}
	objects, err := buildIdentityBundle(&config{managedNS: "opensphere-foundation", keycloakImage: "mirror/keycloak:26.0"}, fm)
	if err != nil {
		t.Fatal(err)
	}
	for _, object := range objects {
		if object.GetKind() != "PostgresClaim" || object.GetName() != "foundation-identity-keycloak-pg" {
			continue
		}
		plan, _, _ := unstructured.NestedString(object.Object, "spec", "planRef", "name")
		if plan != "postgresql-prod-ha-pitr" {
			t.Fatalf("selected database plan not rendered: %q", plan)
		}
		return
	}
	t.Fatal("Keycloak PostgresClaim was not rendered")
}
