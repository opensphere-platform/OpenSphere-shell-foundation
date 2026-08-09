package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func communicationTestModel(engines map[string]interface{}) *unstructured.Unstructured {
	fm := gvkObj(fmGVK)
	fm.SetName("communication")
	fm.Object["spec"] = map[string]interface{}{"model": "communication", "parameters": map[string]interface{}{"engines": engines}}
	return fm
}

func findCommunicationObject(objects []*unstructured.Unstructured, kind, name string) *unstructured.Unstructured {
	for _, object := range objects {
		if object.GetKind() == kind && object.GetName() == name {
			return object
		}
	}
	return nil
}

func TestCommunicationBundleHonorsExplicitEngineDisable(t *testing.T) {
	objects, err := buildCommunicationBundle(&config{managedNS: "foundation"}, communicationTestModel(map[string]interface{}{"stalwart": "disabled", "novu": "disabled", "mattermost": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 0 {
		t.Fatalf("disabled communication engines rendered %d objects", len(objects))
	}
}

func TestStalwartBundleUsesDurableStoreAndExactBootstrapSecret(t *testing.T) {
	cfg := &config{managedNS: "foundation", stalwartImage: "mirror/stalwart@sha256:exact", defaultStorageClass: "standard"}
	objects, err := buildCommunicationBundle(cfg, communicationTestModel(map[string]interface{}{"stalwart": "enabled", "novu": "disabled", "mattermost": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	sts := findCommunicationObject(objects, "StatefulSet", stalwartName)
	if sts == nil || !strings.Contains(toJSON(sts.Object), communicationRuntimeSecret) {
		t.Fatal("Stalwart StatefulSet must reference the exact runtime Secret")
	}
	if findCommunicationObject(objects, "ConfigMap", stalwartName+"-config") == nil {
		t.Fatal("Stalwart immutable data-store bootstrap ConfigMap is missing")
	}
	claims, _, _ := unstructured.NestedSlice(sts.Object, "spec", "volumeClaimTemplates")
	if len(claims) != 1 || !strings.Contains(toJSON(claims), `"name":"data"`) {
		t.Fatalf("Stalwart must keep one durable data PVC: %s", toJSON(claims))
	}
}

func TestNovuBundleConsumesScopedDataClaimsAndAllRequiredSecrets(t *testing.T) {
	cfg := &config{managedNS: "foundation", novuAPIImage: "api", novuWorkerImage: "worker", novuWSImage: "ws", novuDashboardImage: "dashboard"}
	objects, err := buildCommunicationBundle(cfg, communicationTestModel(map[string]interface{}{"stalwart": "disabled", "novu": "enabled", "mattermost": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{novuMongoClaim, novuValkeyClaim} {
		if findCommunicationObject(objects, "FoundationClaim", name) == nil {
			t.Fatalf("Novu scoped dependency %s is missing", name)
		}
	}
	api := findCommunicationObject(objects, "Deployment", novuAPIName)
	if api == nil {
		t.Fatal("Novu API Deployment is missing")
	}
	rendered := toJSON(api.Object)
	for _, value := range []string{communicationRuntimeSecret, "novu-secret-key", novuMongoClaim + "-psmdb-access", novuValkeyClaim + valkeyCredentialSuffix} {
		if !strings.Contains(rendered, value) {
			t.Fatalf("Novu API does not consume %s", value)
		}
	}
	if strings.Contains(rendered, valkeyDefaultAuthSecret) {
		t.Fatal("Novu workload leaked the shared Valkey root credential")
	}
}

func TestMattermostBundleUsesScopedPostgresAndS3Access(t *testing.T) {
	cfg := &config{managedNS: "foundation", mattermostImage: "mattermost"}
	objects, err := buildCommunicationBundle(cfg, communicationTestModel(map[string]interface{}{"stalwart": "disabled", "novu": "disabled", "mattermost": "enabled"}))
	if err != nil {
		t.Fatal(err)
	}
	deployment := findCommunicationObject(objects, "Deployment", mattermostName)
	if deployment == nil {
		t.Fatal("Mattermost Deployment is missing")
	}
	rendered := toJSON(deployment.Object)
	for _, value := range []string{mattermostPostgresClaim + "-binding", mattermostAccessClaim + rustFSCredentialSuffix, `"value":"amazons3"`} {
		if !strings.Contains(rendered, value) {
			t.Fatalf("Mattermost workload does not consume %s", value)
		}
	}
	if strings.Contains(rendered, rustfsDefaultAuthSecret) || strings.Contains(rendered, "amazons3sse") {
		t.Fatal("Mattermost uses a root credential or unsupported S3 driver")
	}
}
