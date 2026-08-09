package main

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func observabilityModel(engines map[string]interface{}) *unstructured.Unstructured {
	fm := gvkObj(fmGVK)
	fm.SetName("observability")
	fm.Object["spec"] = map[string]interface{}{"model": "observability", "parameters": map[string]interface{}{"engines": engines}}
	return fm
}

func TestCollectorPipelineConnectsEnabledNativeOTLPStores(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", collectorImage: "otel:test", tempoImage: "tempo:test", lokiImage: "loki:test", observabilityGatewayImage: "gateway:test"}
	objects, err := buildObservabilityBundle(cfg, observabilityModel(map[string]interface{}{"otel": "enabled", "tempo": "enabled", "loki": "enabled", "grafana-operator": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	var collectorConfig string
	for _, object := range objects {
		if object.GetKind() == "ConfigMap" && object.GetName() == collectorName+"-config" {
			collectorConfig, _, _ = unstructured.NestedString(object.Object, "data", "config.yaml")
		}
	}
	for _, expected := range []string{
		"otlp/tempo:", tempoName + ".opensphere-foundation.svc:4317",
		"otlphttp/loki:", "http://" + lokiName + ".opensphere-foundation.svc:3100/otlp",
		"x-scope-orgid: opensphere-platform",
		"exporters: [otlp/tempo]", "exporters: [otlphttp/loki]",
	} {
		if !strings.Contains(collectorConfig, expected) {
			t.Errorf("collector config is missing %q:\n%s", expected, collectorConfig)
		}
	}
}

func TestCollectorPipelineDoesNotReferenceDisabledStores(t *testing.T) {
	config := collectorPipelineConfig("opensphere-foundation", false, false)
	if strings.Contains(config, "otlp/tempo") || strings.Contains(config, "otlphttp/loki") {
		t.Fatalf("disabled stores leaked into collector config:\n%s", config)
	}
	if strings.Count(config, "exporters: [debug]") != 2 {
		t.Fatalf("trace and log pipelines must retain honest debug fallback:\n%s", config)
	}
}

func TestObservabilityStoresCarryIngressPolicies(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", tempoImage: "tempo:test", lokiImage: "loki:test"}
	for _, bundle := range [][]*unstructured.Unstructured{buildTempoBundle(cfg, observabilityModel(nil)), buildLokiBundle(cfg, observabilityModel(nil))} {
		found := false
		for _, object := range bundle {
			found = found || object.GetKind() == "NetworkPolicy"
		}
		if !found {
			t.Fatal("observability store bundle has no ingress network policy")
		}
	}
}

func TestTempoThreeConfigurationUsesSupportedRootFields(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", tempoImage: "tempo:test"}
	for _, object := range buildTempoBundle(cfg, observabilityModel(nil)) {
		if object.GetKind() != "ConfigMap" || object.GetName() != tempoName+"-config" {
			continue
		}
		value, _, _ := unstructured.NestedString(object.Object, "data", "tempo.yaml")
		if strings.Contains(value, "\ncompactor:") {
			t.Fatalf("Tempo 3 monolithic config contains removed root compactor field:\n%s", value)
		}
		return
	}
	t.Fatal("Tempo configuration ConfigMap was not generated")
}

func TestObservabilityBundleGatesEnginesIndependently(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", collectorImage: "otel:test", tempoImage: "tempo:test", lokiImage: "loki:test", observabilityGatewayImage: "gateway:test"}
	objects, err := buildObservabilityBundle(cfg, observabilityModel(map[string]interface{}{"otel": "disabled", "tempo": "enabled", "loki": "enabled", "grafana-operator": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, object := range objects {
		seen[object.GetLabels()[lblEngine]] = true
	}
	if seen["otel"] || !seen["tempo"] || !seen["loki"] {
		t.Fatalf("engine labels=%v", seen)
	}
}

func TestObservabilityStoresRequireTenantHeaderBehindGateway(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", tempoImage: "tempo:test", lokiImage: "loki:test", observabilityGatewayImage: "gateway:test"}
	objects, err := buildObservabilityBundle(cfg, observabilityModel(map[string]interface{}{"otel": "enabled", "tempo": "enabled", "loki": "enabled", "grafana-operator": "disabled"}))
	if err != nil {
		t.Fatal(err)
	}
	foundGateway := false
	for _, object := range objects {
		if object.GetKind() == "Deployment" && object.GetName() == observabilityGatewayName {
			foundGateway = true
			containers, _, _ := unstructured.NestedSlice(object.Object, "spec", "template", "spec", "containers")
			if containers[0].(map[string]interface{})["image"] != "gateway:test" {
				t.Fatal("tenant gateway image is not wired")
			}
		}
		if object.GetKind() == "ConfigMap" && object.GetName() == tempoName+"-config" {
			value, _, _ := unstructured.NestedString(object.Object, "data", "tempo.yaml")
			if !strings.Contains(value, "multitenancy_enabled: true") {
				t.Fatal("Tempo multi-tenancy is not enabled")
			}
		}
		if object.GetKind() == "ConfigMap" && object.GetName() == lokiName+"-config" {
			value, _, _ := unstructured.NestedString(object.Object, "data", "loki.yaml")
			if !strings.Contains(value, "auth_enabled: true") {
				t.Fatal("Loki multi-tenancy is not enabled")
			}
		}
	}
	if !foundGateway {
		t.Fatal("observability bundle omitted authenticated tenant gateway")
	}
}

func TestObservabilityStatefulSetsUsePinnedImagesAndPersistentStorage(t *testing.T) {
	cfg := &config{managedNS: "opensphere-foundation", tempoImage: "mirror/tempo@sha256:aaa", lokiImage: "mirror/loki@sha256:bbb"}
	for _, object := range append(buildTempoBundle(cfg, observabilityModel(nil)), buildLokiBundle(cfg, observabilityModel(nil))...) {
		if object.GetKind() != "StatefulSet" {
			continue
		}
		containers, _, _ := unstructured.NestedSlice(object.Object, "spec", "template", "spec", "containers")
		image := containers[0].(map[string]interface{})["image"].(string)
		if image != cfg.tempoImage && image != cfg.lokiImage {
			t.Fatalf("unexpected image %q", image)
		}
		claims, _, _ := unstructured.NestedSlice(object.Object, "spec", "volumeClaimTemplates")
		if len(claims) != 1 {
			t.Fatalf("%s has no persistent storage", object.GetName())
		}
	}
}
