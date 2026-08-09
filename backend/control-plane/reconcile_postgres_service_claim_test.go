package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func testFoundationPostgresClaim(requestType string) *unstructured.Unstructured {
	claim := gvkObj(fcGVK)
	claim.SetName("orders-service")
	claim.SetNamespace("tenant-a")
	claim.Object["spec"] = map[string]interface{}{
		"model": "data", "module": "postgres",
		"request":    map[string]interface{}{"type": requestType},
		"parameters": map[string]interface{}{"database": "orders", "owner": "orders_app"},
	}
	return claim
}

func TestFoundationPostgresInstanceRendersDedicatedPostgresClaim(t *testing.T) {
	child, err := renderPostgresServiceClaim(testFoundationPostgresClaim("Instance"))
	if err != nil {
		t.Fatal(err)
	}
	if child.GroupVersionKind() != postgresClaimGVK {
		t.Fatalf("unexpected child GVK: %s", child.GroupVersionKind())
	}
	mode, _, _ := unstructured.NestedString(child.Object, "spec", "isolation")
	plan, _, _ := unstructured.NestedString(child.Object, "spec", "planRef", "name")
	if mode != postgresModeDedicated || plan != "postgresql-compact-2" {
		t.Fatalf("unexpected dedicated contract mode=%s plan=%s", mode, plan)
	}
	if child.GetLabels()["foundation.opensphere.io/service-claim"] != "orders-service" {
		t.Fatal("child PostgresClaim is not traceable to FoundationClaim")
	}
}

func TestFoundationPostgresDatabaseAndAccessRequireManagedTarget(t *testing.T) {
	database := testFoundationPostgresClaim("Database")
	if _, err := renderPostgresServiceClaim(database); err == nil {
		t.Fatal("Database request accepted without target PostgresClaim")
	}
	_ = unstructured.SetNestedMap(database.Object, map[string]interface{}{"name": "platform", "namespace": "opensphere-foundation"}, "spec", "request", "targetRef")
	child, err := renderPostgresServiceClaim(database)
	if err != nil {
		t.Fatal(err)
	}
	mode, _, _ := unstructured.NestedString(child.Object, "spec", "isolation")
	if mode != postgresModeSharedDatabase {
		t.Fatalf("Database mapped to %s", mode)
	}

	access := testFoundationPostgresClaim("Access")
	_ = unstructured.SetNestedMap(access.Object, map[string]interface{}{"name": "platform", "namespace": "opensphere-foundation"}, "spec", "request", "targetRef")
	_ = unstructured.SetNestedField(access.Object, "Owner", "spec", "parameters", "access")
	if _, err := renderPostgresServiceClaim(access); err == nil {
		t.Fatal("Access request accepted owner-level privilege")
	}
}
