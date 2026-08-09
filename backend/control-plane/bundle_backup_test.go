package main

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestBackupBundleDoesNotTakeOwnershipOfIndependentOperators(t *testing.T) {
	objects, err := buildBackupBundle(&config{}, &unstructured.Unstructured{})
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 0 {
		t.Fatalf("backup adapter must not render external operator workloads: %d", len(objects))
	}
}
