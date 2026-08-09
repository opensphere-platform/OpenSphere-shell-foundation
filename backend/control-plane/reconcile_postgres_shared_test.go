package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func testSharedPostgresClaim(mode, access string) *unstructured.Unstructured {
	claim := gvkObj(postgresClaimGVK)
	claim.SetNamespace("consumer-app")
	claim.SetName("orders-data")
	claim.Object["spec"] = map[string]interface{}{
		"isolation":  mode,
		"database":   "orders",
		"owner":      "svc_orders",
		"access":     access,
		"clusterRef": map[string]interface{}{"name": "platform-dev", "namespace": "opensphere-foundation"},
	}
	return claim
}

func testPostgresTarget() postgresTarget {
	claim := testPostgresClaim()
	claim.SetName("platform-dev")
	return postgresTarget{Claim: claim, Namespace: "opensphere-foundation", ClaimName: "platform-dev", ClusterName: "pgc-platform-dev"}
}

func TestSharedDatabaseRendersDatabaseAndOwnerContract(t *testing.T) {
	claim := testSharedPostgresClaim(postgresModeSharedDatabase, "Owner")
	resources, scriptID, err := renderSharedPostgresResources(claim, testPostgresTarget(), postgresModeSharedDatabase, "SecretValue", "svc_orders", false)
	if err != nil {
		t.Fatal(err)
	}
	if scriptID <= 1 {
		t.Fatalf("shared managed SQL id=%d collides with bootstrap", scriptID)
	}
	if len(resources) != 4 || resources[0].GetKind() != "Secret" || resources[1].GetKind() != "SGScript" {
		t.Fatalf("unexpected shared resources: %#v", resources)
	}
	roleSQL, _, _ := unstructured.NestedString(resources[0].Object, "stringData", "role.sql")
	databaseSQL, _, _ := unstructured.NestedString(resources[0].Object, "stringData", "action.sql")
	if !strings.Contains(roleSQL, "CONNECTION LIMIT 20") || !strings.Contains(databaseSQL, `CREATE DATABASE "orders" OWNER "svc_orders"`) {
		t.Fatalf("shared database SQL contract is incomplete: role=%q database=%q", roleSQL, databaseSQL)
	}
	bridge := renderCrossplaneObject(claim, resources[1])
	manifest, _, _ := unstructured.NestedMap(bridge.Object, "spec", "forProvider", "manifest")
	if strings.Contains(fmtSprint(manifest), "SecretValue") {
		t.Fatal("credential material leaked into Crossplane SGScript manifest")
	}
}

func TestDatabaseAccessRendersScopedPrivileges(t *testing.T) {
	claim := testSharedPostgresClaim(postgresModeDatabaseAccess, "ReadOnly")
	resources, _, err := renderSharedPostgresResources(claim, testPostgresTarget(), postgresModeDatabaseAccess, "SecretValue", "orders_owner", false)
	if err != nil {
		t.Fatal(err)
	}
	actionSQL, _, _ := unstructured.NestedString(resources[0].Object, "stringData", "action.sql")
	if !strings.Contains(actionSQL, "GRANT SELECT ON ALL TABLES") || strings.Contains(actionSQL, "INSERT") {
		t.Fatalf("read-only privilege contract is wrong: %q", actionSQL)
	}
	if !strings.Contains(actionSQL, `ALTER DEFAULT PRIVILEGES FOR ROLE "orders_owner"`) {
		t.Fatal("future tables are not governed by the managed database owner")
	}
	scripts, _, _ := unstructured.NestedSlice(resources[1].Object, "spec", "scripts")
	if scripts[1].(map[string]interface{})["database"] != "orders" {
		t.Fatal("database access script is not scoped to the requested database")
	}
}

func TestDatabaseAccessRejectsOwnerPrivilege(t *testing.T) {
	claim := testSharedPostgresClaim(postgresModeDatabaseAccess, "Owner")
	if _, _, err := renderSharedPostgresResources(claim, testPostgresTarget(), postgresModeDatabaseAccess, "SecretValue", "orders_owner", false); err == nil {
		t.Fatal("DatabaseAccess accepted Owner privilege")
	}
}

func TestSharedResourcesAreCollisionSafeAcrossConsumerNamespaces(t *testing.T) {
	a := testSharedPostgresClaim(postgresModeSharedDatabase, "Owner")
	b := a.DeepCopy()
	b.SetNamespace("another-consumer")
	if sharedPostgresResourceStem(a) == sharedPostgresResourceStem(b) || sharedPostgresScriptID(a) == sharedPostgresScriptID(b) {
		t.Fatal("consumer namespaces produced colliding StackGres resources")
	}
}

func TestManagedSQLStatusRequiresRequestedVersion(t *testing.T) {
	claim := testSharedPostgresClaim(postgresModeDatabaseAccess, "ReadOnly")
	id := sharedPostgresScriptID(claim)
	cluster := gvkObj(sgClusterGVK)
	cluster.Object["status"] = map[string]interface{}{"managedSql": map[string]interface{}{"scripts": []interface{}{
		map[string]interface{}{"id": id, "completedAt": "2026-08-10T00:00:00Z", "scripts": []interface{}{map[string]interface{}{"id": int64(1), "version": int64(1)}, map[string]interface{}{"id": int64(2), "version": int64(1)}}},
	}}}
	ready, failed, _ := stackGresManagedSQLStatus(cluster, id, postgresSharedRevokeVersion)
	if ready || failed {
		t.Fatalf("stale managed SQL version accepted: ready=%v failed=%v", ready, failed)
	}
	ready, failed, _ = stackGresManagedSQLStatus(cluster, id, int64(1))
	if !ready || failed {
		t.Fatalf("current managed SQL version rejected: ready=%v failed=%v", ready, failed)
	}
}

func fmtSprint(value interface{}) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(toJSONForTest(value)), "\n", ""), "\t", ""))
}

func toJSONForTest(value interface{}) string {
	data, _ := value.(map[string]interface{})
	return strings.Join(flattenStrings(data), " ")
}

func flattenStrings(value interface{}) []string {
	out := []string{}
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, item := range typed {
			out = append(out, key)
			out = append(out, flattenStrings(item)...)
		}
	case []interface{}:
		for _, item := range typed {
			out = append(out, flattenStrings(item)...)
		}
	case string:
		out = append(out, typed)
	}
	return out
}
