package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func TestPSMDBServiceClaimRendersNativeOperatorResource(t *testing.T) {
	claim := gvkObj(fcGVK)
	claim.SetName("orders-mongo")
	claim.SetNamespace("tenant-a")
	claim.SetUID(types.UID("claim-uid"))
	claim.Object["spec"] = map[string]interface{}{
		"model": "data", "module": "percona-psmdb",
		"request": map[string]interface{}{"type": "Instance"},
		"parameters": map[string]interface{}{
			"database": "orders", "owner": "orders_app", "replicas": int64(3),
			"storage": map[string]interface{}{"size": "50Gi", "storageClass": "ceph-rbd"},
		},
	}
	resource, err := renderPSMDBServiceInstance(claim, &config{psmdbImage: "mirror/psmdb@sha256:abc", defaultStorageClass: "standard"})
	if err != nil {
		t.Fatal(err)
	}
	if resource.GetKind() != "PerconaServerMongoDB" || resource.GetName() != claim.GetName() || resource.GetNamespace() != claim.GetNamespace() {
		t.Fatalf("unexpected native resource %s/%s/%s", resource.GetKind(), resource.GetNamespace(), resource.GetName())
	}
	if image, _, _ := unstructured.NestedString(resource.Object, "spec", "image"); image != "mirror/psmdb@sha256:abc" {
		t.Fatalf("image=%q", image)
	}
	users, _, _ := unstructured.NestedSlice(resource.Object, "spec", "users")
	user := users[0].(map[string]interface{})
	if user["name"] != "orders_app" || user["db"] != "orders" {
		t.Fatalf("user=%v", user)
	}
	replsets, _, _ := unstructured.NestedSlice(resource.Object, "spec", "replsets")
	if replsets[0].(map[string]interface{})["size"] != int64(3) {
		t.Fatalf("replsets=%v", replsets)
	}
	if resource.GetLabels()["foundation.opensphere.io/service-claim"] != claim.GetName() {
		t.Fatalf("ownership labels=%v", resource.GetLabels())
	}
}

func TestPSMDBReadinessDoesNotGuess(t *testing.T) {
	resource := gvkObj(psmdbGVK)
	resource.Object["status"] = map[string]interface{}{"state": "initializing"}
	if psmdbResourceReady(resource) {
		t.Fatal("initializing PSMDB must not be reported Ready")
	}
	resource.Object["status"] = map[string]interface{}{"state": "ready"}
	if !psmdbResourceReady(resource) {
		t.Fatal("ready PSMDB was not recognized")
	}
}

func TestPSMDBDesiredUserUsesPerconaPasswordSecretContract(t *testing.T) {
	user := psmdbDesiredUser("orders_app", "orders", "readWrite", "orders-credentials")
	if user["name"] != "orders_app" || user["db"] != "orders" || psmdbUserCredentialName(user) != "orders-credentials" {
		t.Fatalf("user=%v", user)
	}
	roles := user["roles"].([]interface{})
	role := roles[0].(map[string]interface{})
	if role["name"] != "readWrite" || role["db"] != "orders" {
		t.Fatalf("roles=%v", roles)
	}
}

func TestPSMDBUserCredentialOwnershipIsExplicit(t *testing.T) {
	first := psmdbDesiredUser("orders_app", "orders", "readWrite", "claim-a-secret")
	second := psmdbDesiredUser("orders_app", "orders", "read", "claim-b-secret")
	if psmdbUserCredentialName(first) == psmdbUserCredentialName(second) {
		t.Fatalf("different claims must retain distinct credential ownership: %v %v", first, second)
	}
}
