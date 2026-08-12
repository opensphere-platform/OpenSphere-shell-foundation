package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestDependencyClaimNameIsStableDNSLabel(t *testing.T) {
	short := dependencyClaimName("mattermost-prod", "postgres", "Database")
	if short != "mattermost-prod-dep-postgres-database" {
		t.Fatalf("short dependency name=%q", short)
	}
	long := dependencyClaimName(strings.Repeat("a", 50), "percona-psmdb", "Database")
	if len(long) > 63 || !dnsLabelPattern.MatchString(long) {
		t.Fatalf("long dependency name must be a DNS label: %q", long)
	}
	if long != dependencyClaimName(strings.Repeat("a", 50), "percona-psmdb", "Database") {
		t.Fatal("dependency name is not deterministic")
	}
}

func TestDependencyTargetRulesOnlyCreateDataInstanceWhenRequired(t *testing.T) {
	for _, tc := range []struct {
		module, request string
		want            bool
	}{
		{"postgres", "Database", true},
		{"postgres", "Access", true},
		{"percona-psmdb", "Database", true},
		{"rustfs", "Bucket", false},
		{"valkey", "Access", false},
	} {
		if got := dependencyNeedsTarget(tc.module, tc.request); got != tc.want {
			t.Errorf("dependencyNeedsTarget(%s,%s)=%t want %t", tc.module, tc.request, got, tc.want)
		}
	}
}

func TestDependencyOverrideAcceptsCanonicalExternalModuleKey(t *testing.T) {
	claim := &unstructured.Unstructured{Object: map[string]interface{}{
		"spec": map[string]interface{}{"parameters": map[string]interface{}{"dependencies": map[string]interface{}{
			"external:clickhouse": map[string]interface{}{"endpoint": "tcp://clickhouse.example:9000"},
		}}},
	}}
	override, found := serviceDependencyOverride(claim, "external:clickhouse")
	if !found || override["endpoint"] != "tcp://clickhouse.example:9000" {
		t.Fatalf("external dependency override=%v found=%t", override, found)
	}
}

func TestBindingProjectionPublishesOnlyReconciledDependencies(t *testing.T) {
	binding := gvkObj(fbGVK)
	projection := serviceBindingProjection{Dependencies: []serviceDependencyBinding{{
		Module: "postgres", RequestType: "Database", Required: true,
		BindingRef: map[string]interface{}{"name": "chat-db-binding", "namespace": "tenant-a"},
		Endpoint:   "postgresql://chat-db.tenant-a.svc:5432",
	}}}
	if err := projection.apply(binding); err != nil {
		t.Fatal(err)
	}
	dependencies, found, err := unstructured.NestedSlice(binding.Object, "spec", "dependencies")
	if err != nil || !found || len(dependencies) != 1 {
		t.Fatalf("dependencies=%v found=%t err=%v", dependencies, found, err)
	}
	item := dependencies[0].(map[string]interface{})
	if item["module"] != "postgres" || item["required"] != true {
		t.Fatalf("dependency projection=%v", item)
	}
}
