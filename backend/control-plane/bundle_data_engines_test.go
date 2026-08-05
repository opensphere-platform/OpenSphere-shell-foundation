package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestImageWithTagPreservesExactDigest(t *testing.T) {
	exact := "ghcr.io/opensphere-platform/mirror/valkey@sha256:c9b77919daeba2c02ad954d0c844cc4e7142069d177b89c5fd771f405daf9e02"
	if got := imageWithTag(exact, "9.1.0-alpine"); got != exact {
		t.Fatalf("exact digest changed to %q", got)
	}
}

func TestImageWithTagReplacesMutableTag(t *testing.T) {
	base := "ghcr.io/opensphere-platform/mirror/valkey:edge"
	want := "ghcr.io/opensphere-platform/mirror/valkey:9.1.0-alpine"
	if got := imageWithTag(base, "9.1.0-alpine"); got != want {
		t.Fatalf("imageWithTag() = %q, want %q", got, want)
	}
}

func TestOpenSearchServiceMonitorTargetsPluginMetrics(t *testing.T) {
	u := opensearchServiceMonitor("opensphere-foundation", "data")
	if u.GetKind() != "ServiceMonitor" || u.GetNamespace() != "opensphere-foundation" {
		t.Fatalf("unexpected ServiceMonitor identity: %s %s/%s", u.GetKind(), u.GetNamespace(), u.GetName())
	}
	namespaces, found, err := unstructured.NestedStringSlice(u.Object, "spec", "namespaceSelector", "matchNames")
	if err != nil || !found || len(namespaces) != 1 || namespaces[0] != "opensphere-console" {
		t.Fatalf("namespaceSelector = %#v, found=%v, err=%v", namespaces, found, err)
	}
	selector, found, err := unstructured.NestedStringMap(u.Object, "spec", "selector", "matchLabels")
	if err != nil || !found || selector["opensphere.io/dupa-plugin"] != "opensearch" {
		t.Fatalf("selector = %#v, found=%v, err=%v", selector, found, err)
	}
	endpoints, found, err := unstructured.NestedSlice(u.Object, "spec", "endpoints")
	if err != nil || !found || len(endpoints) != 1 {
		t.Fatalf("endpoints = %#v, found=%v, err=%v", endpoints, found, err)
	}
	endpoint := endpoints[0].(map[string]interface{})
	if endpoint["port"] != "http" || endpoint["path"] != "/metrics" || endpoint["interval"] != "15s" {
		t.Fatalf("unexpected endpoint: %#v", endpoint)
	}
}
