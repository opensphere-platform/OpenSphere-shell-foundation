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

func TestPSMDBBundleUsesOperator123ProductionContract(t *testing.T) {
	fm := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "foundation.opensphere.io/v1alpha1", "kind": "FoundationModel",
		"metadata": map[string]interface{}{"name": "data"},
		"spec": map[string]interface{}{"parameters": map[string]interface{}{
			"namespace": "opensphere-foundation",
			"dataEngines": map[string]interface{}{"psmdb": map[string]interface{}{
				"version": "8.0.26-11", "replicas": int64(3), "storageClass": "ceph-rbd", "storageSize": "20Gi",
			}},
		}},
	}}
	cfg := &config{managedNS: "opensphere-foundation", defaultStorageClass: "ceph-rbd", psmdbImage: "ghcr.io/opensphere-platform/mirror/percona-server-mongodb@sha256:53f89c001997627554e6afc0feb5906209ba109f4f98c62f2ca8456c214af60c"}
	bundle, err := buildPSMDBBundle(cfg, fm)
	if err != nil || len(bundle) != 2 {
		t.Fatalf("buildPSMDBBundle() len=%d err=%v", len(bundle), err)
	}
	cr := bundle[0]
	if got, _, _ := unstructured.NestedString(cr.Object, "spec", "crVersion"); got != "1.23.0" {
		t.Fatalf("crVersion=%q", got)
	}
	if got, _, _ := unstructured.NestedString(cr.Object, "spec", "image"); got != cfg.psmdbImage {
		t.Fatalf("exact image changed to %q", got)
	}
	if got, _, _ := unstructured.NestedString(cr.Object, "spec", "tls", "mode"); got != "preferTLS" {
		t.Fatalf("tls.mode=%q", got)
	}
	if unsafe, _, _ := unstructured.NestedBool(cr.Object, "spec", "unsafeFlags", "replsetSize"); unsafe {
		t.Fatal("production 3-member ReplicaSet cannot enable unsafe replsetSize")
	}
	if got, _, _ := unstructured.NestedString(cr.Object, "spec", "secrets", "users"); got != "foundation-data-mongodb-secrets" {
		t.Fatalf("secrets.users=%q", got)
	}
	if finalizers := cr.GetFinalizers(); len(finalizers) != 1 || finalizers[0] != "percona.com/delete-psmdb-pods-in-order" {
		t.Fatalf("safe finalizers=%v", finalizers)
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
