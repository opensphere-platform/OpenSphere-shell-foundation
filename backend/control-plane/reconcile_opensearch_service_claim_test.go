package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestOpenSearchIndexValidationRejectsUnsafeNames(t *testing.T) {
	for _, name := range []string{"orders-2026", "logs.v1", "tenant_index"} {
		if !validOpenSearchIndex(name) {
			t.Errorf("valid index rejected: %q", name)
		}
	}
	for _, name := range []string{"", "Uppercase", "_system", "../escape", "space name"} {
		if validOpenSearchIndex(name) {
			t.Errorf("unsafe index accepted: %q", name)
		}
	}
}

func TestOpenSearchIndexBodyBoundsShardAndReplicaCounts(t *testing.T) {
	claim := &unstructured.Unstructured{Object: map[string]interface{}{"spec": map[string]interface{}{"parameters": map[string]interface{}{
		"shards": int64(3), "replicas": int64(2), "mappings": map[string]interface{}{"properties": map[string]interface{}{"message": map[string]interface{}{"type": "text"}}},
	}}}}
	body, valid := openSearchIndexBody(claim)
	if !valid {
		t.Fatal("valid index settings rejected")
	}
	settings := body["settings"].(map[string]interface{})
	if settings["number_of_shards"] != int64(3) || settings["number_of_replicas"] != int64(2) || body["mappings"] == nil {
		t.Fatalf("index body=%v", body)
	}
	_ = unstructured.SetNestedField(claim.Object, int64(101), "spec", "parameters", "shards")
	if _, valid := openSearchIndexBody(claim); valid {
		t.Fatal("unbounded shard count accepted")
	}
}

func TestEnsureOpenSearchIndexCreatesAndWaitsForYellow(t *testing.T) {
	var putBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/orders":
			if request.Method != http.MethodPut {
				t.Fatalf("method=%s", request.Method)
			}
			_ = json.NewDecoder(request.Body).Decode(&putBody)
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"acknowledged":true}`))
		case "/_cluster/health/orders":
			if request.URL.Query().Get("wait_for_status") != "yellow" {
				t.Fatalf("health query=%s", request.URL.RawQuery)
			}
			_, _ = writer.Write([]byte(`{"status":"yellow","timed_out":false}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	ready, err := ensureOpenSearchIndex(context.Background(), server.Client(), server.URL, "orders", map[string]interface{}{"settings": map[string]interface{}{"number_of_shards": int64(1)}})
	if err != nil || !ready || putBody["settings"] == nil {
		t.Fatalf("ready=%t err=%v body=%v", ready, err, putBody)
	}
}

func TestEnsureOpenSearchIndexAcceptsIdempotentAlreadyExists(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/orders" {
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"error":{"type":"resource_already_exists_exception"}}`))
			return
		}
		_, _ = writer.Write([]byte(`{"status":"green","timed_out":false}`))
	}))
	defer server.Close()
	ready, err := ensureOpenSearchIndex(context.Background(), server.Client(), server.URL, "orders", map[string]interface{}{})
	if err != nil || !ready {
		t.Fatalf("ready=%t err=%v", ready, err)
	}
}

func TestOpenSearchBundleUsesSecuredUpstreamOperatorCluster(t *testing.T) {
	fm := object(fmGVK, "", "data")
	fm.Object["spec"] = map[string]interface{}{"parameters": map[string]interface{}{
		"opensearch": map[string]interface{}{"version": "3.7.0", "replicas": int64(1), "storageSize": "10Gi"},
	}}
	cfg := &config{managedNS: "opensphere-foundation", defaultStorageClass: "standard", opensearchImage: "ghcr.io/opensphere-platform/mirror/opensearch:3.7.0"}
	objects, err := buildOpenSearchBundle(cfg, fm)
	if err != nil {
		t.Fatal(err)
	}
	var cluster *unstructured.Unstructured
	for _, item := range objects {
		if item.GetKind() == "StatefulSet" {
			t.Fatal("OpenSearch must not regress to a directly managed StatefulSet")
		}
		if item.GetKind() == "OpenSearchCluster" {
			cluster = item
		}
	}
	if cluster == nil || cluster.GetAPIVersion() != "opensearch.opster.io/v1" {
		t.Fatalf("operator cluster missing: %#v", cluster)
	}
	disable, found, _ := unstructured.NestedBool(cluster.Object, "spec", "security", "disable")
	if found && disable {
		t.Fatal("OpenSearch security plugin must remain enabled")
	}
	adminSecret, _, _ := unstructured.NestedString(cluster.Object, "spec", "security", "config", "adminCredentialsSecret", "name")
	securityConfig, _, _ := unstructured.NestedString(cluster.Object, "spec", "security", "config", "securityConfigSecret", "name")
	httpTLS, _, _ := unstructured.NestedBool(cluster.Object, "spec", "security", "tls", "http", "generate")
	if adminSecret != openSearchAdminSecretName || securityConfig != openSearchSecurityConfigSecretName || !httpTLS {
		t.Fatalf("adminSecret=%q securityConfig=%q httpTLS=%v cluster=%v", adminSecret, securityConfig, httpTLS, cluster.Object["spec"])
	}
	dashboardsEnabled, _, _ := unstructured.NestedBool(cluster.Object, "spec", "dashboards", "enable")
	dashboardsReplicas, replicasFound, _ := unstructured.NestedInt64(cluster.Object, "spec", "dashboards", "replicas")
	dashboardsVersion, versionFound, _ := unstructured.NestedString(cluster.Object, "spec", "dashboards", "version")
	if dashboardsEnabled || !replicasFound || dashboardsReplicas != 1 || !versionFound || dashboardsVersion != "3.7.0" {
		t.Fatalf("disabled Dashboards must still satisfy the operator schema: %#v", cluster.Object["spec"].(map[string]interface{})["dashboards"])
	}
	initHelperImage, found, _ := unstructured.NestedString(cluster.Object, "spec", "initHelper", "image")
	if !found || initHelperImage != openSearchInitHelperImage || !strings.Contains(initHelperImage, "@sha256:") {
		t.Fatalf("OpenSearch init helper must be an immutable Foundation mirror: %q", initHelperImage)
	}
	podSecurityContext, _, _ := unstructured.NestedMap(cluster.Object, "spec", "general", "podSecurityContext")
	if _, blocksRootInit := podSecurityContext["runAsNonRoot"]; blocksRootInit || podSecurityContext["runAsUser"] != int64(1000) {
		t.Fatalf("OpenSearch process must remain UID 1000 without blocking the operator root init helper: %#v", podSecurityContext)
	}
}

func TestOpenSearchSecurityDocumentsBindAdminPassword(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("a-strong-platform-password"), 4)
	if err != nil {
		t.Fatal(err)
	}
	docs := openSearchSecurityDocuments(string(hash))
	for _, key := range []string{"action_groups.yml", "internal_users.yml", "nodes_dn.yml", "whitelist.yml", "tenants.yml", "roles_mapping.yml", "roles.yml", "config.yml"} {
		if strings.TrimSpace(docs[key]) == "" {
			t.Fatalf("security document %s missing", key)
		}
	}
	match := openSearchAdminHashPattern.FindStringSubmatch(docs["internal_users.yml"])
	if len(match) != 2 || bcrypt.CompareHashAndPassword([]byte(match[1]), []byte("a-strong-platform-password")) != nil {
		t.Fatal("internal_users.yml is not bound to the platform credential")
	}
}

func TestOpenSearchAccessPolicyIsExplicitAndLeastPrivilege(t *testing.T) {
	claim := stalwartTestClaim("Access", map[string]interface{}{"indexPatterns": []interface{}{"orders-*"}, "access": "ReadOnly"})
	patterns, clusterActions, indexActions, reason := openSearchAccessPolicy(claim)
	if reason != "" || len(patterns) != 1 || patterns[0] != "orders-*" {
		t.Fatalf("patterns=%v reason=%q", patterns, reason)
	}
	joined := strings.Join(append(clusterActions, indexActions...), ",")
	if strings.Contains(joined, "all_access") || strings.Contains(joined, "indices_all") || !strings.Contains(joined, "read") {
		t.Fatalf("read-only actions are over-broad or incomplete: %s", joined)
	}
	claim.Object["spec"].(map[string]interface{})["parameters"] = map[string]interface{}{"access": "ReadWrite"}
	_, _, _, reason = openSearchAccessPolicy(claim)
	if reason != "OpenSearchIndexPatternsRequired" {
		t.Fatalf("implicit cluster-wide access accepted: %q", reason)
	}
}

func TestOpenSearchAccessIdentityIsNamespaceStableAndOwned(t *testing.T) {
	first := stalwartTestClaim("Access", nil)
	first.SetName("orders-search")
	first.SetUID("uid-1")
	second := first.DeepCopy()
	second.SetNamespace("tenant-b")
	if openSearchAccessName(first) == openSearchAccessName(second) {
		t.Fatal("consumer namespaces must not collide on operator user name")
	}
	resource := object(openSearchUserGVK, "opensphere-foundation", openSearchAccessName(first))
	stampOpenSearchClaimOwnership(resource, first)
	if !openSearchClaimOwned(resource, first) || openSearchClaimOwned(resource, second) {
		t.Fatalf("ownership labels=%v", resource.GetLabels())
	}
}

func TestOpenSearchCatalogExposesSecuredManagedAccess(t *testing.T) {
	contract, _ := serviceContract("opensearch")
	if contract.requestMode("Access") != "managed" || !contract.requestReady("Access") {
		t.Fatal("OpenSearch Access must be backed by operator-managed role/user resources")
	}
}
