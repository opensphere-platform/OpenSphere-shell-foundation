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
	claim := testFoundationPostgresClaim("Instance")
	_ = unstructured.SetNestedField(claim.Object, "postgresql-dev-single", "spec", "parameters", "plan")
	_ = unstructured.SetNestedField(claim.Object, "18.4", "spec", "parameters", "postgresVersion")
	_ = unstructured.SetNestedField(claim.Object, "Retain", "spec", "parameters", "deletionPolicy")
	claim.SetAnnotations(map[string]string{"opensphere.io/display-name": "Orders PostgreSQL"})
	child, err := renderPostgresServiceClaim(claim)
	if err != nil {
		t.Fatal(err)
	}
	if child.GroupVersionKind() != postgresClaimGVK {
		t.Fatalf("unexpected child GVK: %s", child.GroupVersionKind())
	}
	mode, _, _ := unstructured.NestedString(child.Object, "spec", "isolation")
	plan, _, _ := unstructured.NestedString(child.Object, "spec", "planRef", "name")
	version, _, _ := unstructured.NestedString(child.Object, "spec", "postgresVersion")
	deletionPolicy, _, _ := unstructured.NestedString(child.Object, "spec", "deletionPolicy")
	if mode != postgresModeDedicated || plan != "postgresql-dev-single" || version != "18.4" || deletionPolicy != "Retain" {
		t.Fatalf("unexpected dedicated contract mode=%s plan=%s", mode, plan)
	}
	if child.GetLabels()["foundation.opensphere.io/service-claim"] != "orders-service" {
		t.Fatal("child PostgresClaim is not traceable to FoundationClaim")
	}
	if child.GetAnnotations()["opensphere.io/display-name"] != "Orders PostgreSQL" {
		t.Fatal("display name was not propagated")
	}
}

func TestFoundationPostgresInstanceDoesNotInventPlanOrVersion(t *testing.T) {
	if _, err := renderPostgresServiceClaim(testFoundationPostgresClaim("Instance")); err == nil {
		t.Fatal("Instance request without an explicit owner plan/version must be rejected")
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
