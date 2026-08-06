package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func testPostgresClaim() *unstructured.Unstructured {
	o := gvkObj(postgresClaimGVK)
	o.SetName("orders")
	o.SetNamespace("tenant-a")
	o.SetUID(types.UID("claim-uid"))
	o.Object["spec"] = map[string]interface{}{
		"database":       "orders",
		"owner":          "orders_app",
		"planRef":        map[string]interface{}{"name": "postgresql-compact-2"},
		"isolation":      "Dedicated",
		"deletionPolicy": "Retain",
	}
	return o
}

func TestDedicatedClaimRendersOneStackGresCluster(t *testing.T) {
	claim := testPostgresClaim()
	plan := postgresPlan{
		Name: "postgresql-compact-2", Version: "18", Profile: "testing",
		CPU: "1", Memory: "2Gi", Size: "20Gi", StorageClass: "ceph-rbd",
		Instances: 2, Pooling: true,
	}
	resources := renderPostgresResources(claim, plan, "S3curePassword")
	count := 0
	var cluster *unstructured.Unstructured
	for _, resource := range resources {
		if resource.GetKind() == "SGCluster" {
			count++
			cluster = resource
		}
		if resource.GetNamespace() != "tenant-a" {
			t.Fatalf("%s rendered outside claim namespace: %s", resource.GetKind(), resource.GetNamespace())
		}
		if resource.GetLabels()["provisioning.opensphere.io/postgres-claim"] != "orders" {
			t.Fatalf("%s lacks exact claim ownership label", resource.GetKind())
		}
	}
	if count != 1 {
		t.Fatalf("SGCluster count=%d, want 1", count)
	}
	if cluster.GetName() != "pgc-orders" {
		t.Fatalf("cluster name=%s", cluster.GetName())
	}
	if got, _, _ := unstructured.NestedInt64(cluster.Object, "spec", "instances"); got != 2 {
		t.Fatalf("instances=%d", got)
	}
	if got, _, _ := unstructured.NestedString(cluster.Object, "spec", "profile"); got != "testing" {
		t.Fatalf("profile=%s", got)
	}
	if got, _, _ := unstructured.NestedString(cluster.Object, "spec", "configurations", "binding", "username"); got != "orders_app" {
		t.Fatalf("binding username=%s", got)
	}
	if _, found, _ := unstructured.NestedMap(cluster.Object, "spec", "configurations", "credentials", "users", "superuser"); found {
		t.Fatal("application binding must never expose StackGres superuser credentials")
	}
}

func TestBootstrapSQLUsesApplicationIdentity(t *testing.T) {
	resources := renderPostgresResources(testPostgresClaim(), postgresPlan{
		Name: "postgresql-dev-single", Version: "18", Profile: "development",
		CPU: "500m", Memory: "1Gi", Size: "10Gi", Instances: 1,
	}, "SecretValue")
	for _, resource := range resources {
		if resource.GetName() != "pgc-orders-bootstrap-sql" {
			continue
		}
		roleSQL, _, _ := unstructured.NestedString(resource.Object, "stringData", "role.sql")
		databaseSQL, _, _ := unstructured.NestedString(resource.Object, "stringData", "database.sql")
		if !strings.Contains(roleSQL, "CREATE ROLE \"orders_app\"") || !strings.Contains(databaseSQL, "CREATE DATABASE \"orders\" OWNER \"orders_app\"") {
			t.Fatalf("unexpected bootstrap SQL: role=%s database=%s", roleSQL, databaseSQL)
		}
		if strings.Contains(roleSQL, "SUPERUSER") || strings.Contains(databaseSQL, "SUPERUSER") {
			t.Fatal("bootstrap application role must not be superuser")
		}
		return
	}
	t.Fatal("bootstrap SQL Secret not rendered")
}

func TestProductionPlanRequiresObjectStorage(t *testing.T) {
	o := gvkObj(addOnPlanGVK)
	o.SetName("broken")
	o.Object["spec"] = map[string]interface{}{
		"provider": "stackgres", "lifecycle": "Available", "postgresVersion": "18",
		"instances": int64(3), "profile": "production",
		"resources": map[string]interface{}{"cpu": "2", "memory": "4Gi"},
		"storage":   map[string]interface{}{"size": "100Gi"},
		"backup":    map[string]interface{}{"enabled": true},
	}
	if _, err := parsePostgresPlan(o); err == nil || !strings.Contains(err.Error(), "objectStorageRef") {
		t.Fatalf("expected objectStorageRef validation, got %v", err)
	}
}

func TestClaimRejectsUnsafeSQLIdentifier(t *testing.T) {
	claim := testPostgresClaim()
	_ = unstructured.SetNestedField(claim.Object, "orders; DROP DATABASE postgres", "spec", "database")
	if err := validatePostgresClaim(claim); err == nil {
		t.Fatal("unsafe database identifier accepted")
	}
}

func TestRetainIsTheDefaultInstallDeletionPolicy(t *testing.T) {
	claim := testPostgresClaim()
	unstructured.RemoveNestedField(claim.Object, "spec", "deletionPolicy")
	install := renderAddOnInstall(claim, postgresPlan{Name: "postgresql-dev-single"}, nil)
	if got, _, _ := unstructured.NestedString(install.Object, "spec", "deletionPolicy"); got != "Retain" {
		t.Fatalf("deletionPolicy=%s", got)
	}
}

func TestStackGres119ConditionsAreReadyWithBinding(t *testing.T) {
	cluster := gvkObj(sgClusterGVK)
	cluster.Object["status"] = map[string]interface{}{
		"binding": map[string]interface{}{"name": "orders-binding"},
		"conditions": []interface{}{
			map[string]interface{}{"type": "Bootstrapped", "status": "True"},
			map[string]interface{}{"type": "ComponentsUpdated", "status": "True"},
			map[string]interface{}{"type": "Failed", "status": "False"},
		},
		"managedSql": map[string]interface{}{"scripts": []interface{}{
			map[string]interface{}{"id": int64(1), "completedAt": "2026-08-06T00:00:00Z"},
		}},
	}
	if !stackGresReady(cluster) {
		t.Fatal("StackGres 1.19 ready conditions were not recognized")
	}
	cluster.Object["status"].(map[string]interface{})["conditions"].([]interface{})[2] = map[string]interface{}{"type": "Failed", "status": "True"}
	if stackGresReady(cluster) {
		t.Fatal("failed StackGres cluster was reported Ready")
	}
}

func TestStackGresBootstrapFailureIsNotReady(t *testing.T) {
	cluster := gvkObj(sgClusterGVK)
	cluster.Object["status"] = map[string]interface{}{
		"binding": map[string]interface{}{"name": "orders-binding"},
		"conditions": []interface{}{
			map[string]interface{}{"type": "Bootstrapped", "status": "True"},
			map[string]interface{}{"type": "ComponentsUpdated", "status": "True"},
			map[string]interface{}{"type": "Failed", "status": "False"},
		},
		"managedSql": map[string]interface{}{"scripts": []interface{}{
			map[string]interface{}{
				"id": int64(1), "failedAt": "2026-08-06T00:00:00Z",
				"scripts": []interface{}{map[string]interface{}{"id": int64(2), "failure": "database bootstrap failed"}},
			},
		}},
	}
	if stackGresReady(cluster) {
		t.Fatal("failed application database bootstrap was reported Ready")
	}
	ready, failed, message := stackGresBootstrapStatus(cluster)
	if ready || !failed || !strings.Contains(message, "database bootstrap failed") {
		t.Fatalf("unexpected bootstrap status: ready=%v failed=%v message=%q", ready, failed, message)
	}
}

func TestBootstrapStatementsAreSeparateAutoCommitEntries(t *testing.T) {
	resources := renderPostgresResources(testPostgresClaim(), postgresPlan{
		Name: "postgresql-dev-single", Version: "18", Profile: "development",
		CPU: "500m", Memory: "1Gi", Size: "10Gi", Instances: 1,
	}, "SecretValue")
	for _, resource := range resources {
		if resource.GetKind() != "SGScript" {
			continue
		}
		scripts, _, _ := unstructured.NestedSlice(resource.Object, "spec", "scripts")
		if len(scripts) != 2 {
			t.Fatalf("bootstrap script entries=%d, want 2", len(scripts))
		}
		for _, item := range scripts {
			entry := item.(map[string]interface{})
			if _, wrapped := entry["wrapInTransaction"]; wrapped {
				t.Fatal("CREATE DATABASE bootstrap must not be wrapped in a transaction")
			}
		}
		return
	}
	t.Fatal("SGScript not rendered")
}

func TestLegacySharedClaimUsesTheFixedCompatibilityTarget(t *testing.T) {
	claim := testPostgresClaim()
	claim.SetName("foundation-data-pg-legacy")
	claim.SetNamespace("opensphere-foundation")
	_ = unstructured.SetNestedField(claim.Object, "LegacyShared", "spec", "isolation")
	setLegacyPostgresStatus(claim, claim.GetNamespace())
	provider, _, _ := unstructured.NestedMap(claim.Object, "status", "providerRef")
	if provider["kind"] != "Cluster" || provider["name"] != "foundation-data-pg" {
		t.Fatalf("unexpected legacy providerRef: %#v", provider)
	}
	binding, _, _ := unstructured.NestedMap(claim.Object, "status", "bindingRef")
	if binding["name"] != "foundation-data-pg-app" {
		t.Fatalf("unexpected legacy bindingRef: %#v", binding)
	}
}
