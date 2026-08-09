package main

import (
	"fmt"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	grafanaName          = "foundation-observability-grafana"
	grafanaSelectorKey   = "observability.opensphere.io/grafana-instance"
	grafanaSelectorValue = "foundation"
)

var (
	grafanaGVK               = schema.GroupVersionKind{Group: "grafana.integreatly.org", Version: "v1beta1", Kind: "Grafana"}
	grafanaDashboardGVK      = schema.GroupVersionKind{Group: "grafana.integreatly.org", Version: "v1beta1", Kind: "GrafanaDashboard"}
	grafanaDatasourceGVK     = schema.GroupVersionKind{Group: "grafana.integreatly.org", Version: "v1beta1", Kind: "GrafanaDatasource"}
	grafanaServiceAccountGVK = schema.GroupVersionKind{Group: "grafana.integreatly.org", Version: "v1beta1", Kind: "GrafanaServiceAccount"}
)

func grafanaEndpoint(cfg *config) string {
	return fmt.Sprintf("http://%s-service.%s.svc:3000", grafanaName, cfg.managedNS)
}

func grafanaProbe(cfg *config) string {
	return fmt.Sprintf("%s-service.%s.svc:3000", grafanaName, cfg.managedNS)
}

func buildGrafanaBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	labels := map[string]string{
		"app.kubernetes.io/name":      "grafana",
		"app.kubernetes.io/instance":  grafanaName,
		"app.kubernetes.io/component": "visualization",
		"app.kubernetes.io/part-of":   "foundation-observability",
		grafanaSelectorKey:            grafanaSelectorValue,
	}
	grafana := object(grafanaGVK, cfg.managedNS, grafanaName)
	grafana.SetLabels(labels)
	stampLabels(grafana, "observability", fm.GetName())
	grafana.Object["spec"] = map[string]interface{}{
		// Grafana Operator accepts a complete image reference in spec.version.  The
		// platform passes only its canonical GHCR mirror so the operand never pulls
		// from an ungoverned public registry at runtime.
		"version": cfg.grafanaImage,
		"config": map[string]interface{}{
			"analytics":      map[string]interface{}{"reporting_enabled": "false", "check_for_updates": "false"},
			"auth.anonymous": map[string]interface{}{"enabled": "false"},
			"log":            map[string]interface{}{"mode": "console", "level": "info"},
			"security": map[string]interface{}{
				"disable_gravatar": "true",
				"cookie_samesite":  "strict",
			},
			"users": map[string]interface{}{"allow_sign_up": "false"},
		},
		"deployment": map[string]interface{}{
			"spec": map[string]interface{}{
				"replicas": int64(1),
				"strategy": map[string]interface{}{"type": "Recreate"},
				"template": map[string]interface{}{
					"spec": map[string]interface{}{
						"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
						"securityContext":  map[string]interface{}{"runAsNonRoot": true, "runAsUser": int64(472), "runAsGroup": int64(472), "fsGroup": int64(472)},
						"containers": []interface{}{map[string]interface{}{
							"name": "grafana",
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{"cpu": "100m", "memory": "256Mi"},
								"limits":   map[string]interface{}{"cpu": "1", "memory": "1Gi"},
							},
							"securityContext": map[string]interface{}{
								"allowPrivilegeEscalation": false,
								"capabilities":             map[string]interface{}{"drop": []interface{}{"ALL"}},
							},
						}},
					},
				},
			},
		},
		"persistentVolumeClaim": map[string]interface{}{
			"spec": map[string]interface{}{
				"accessModes":      []interface{}{"ReadWriteOnce"},
				"storageClassName": cfg.defaultStorageClass,
				"resources":        map[string]interface{}{"requests": map[string]interface{}{"storage": "10Gi"}},
			},
		},
		"service": map[string]interface{}{
			"spec": map[string]interface{}{"type": "ClusterIP"},
		},
	}
	return []*unstructured.Unstructured{grafana}
}

func grafanaObjectReady(grafana *unstructured.Unstructured) bool {
	stage, _, _ := unstructured.NestedString(grafana.Object, "status", "stage")
	stageStatus, _, _ := unstructured.NestedString(grafana.Object, "status", "stageStatus")
	if stage != "complete" || stageStatus != "success" {
		return false
	}
	conditions, _, _ := unstructured.NestedSlice(grafana.Object, "status", "conditions")
	for _, item := range conditions {
		condition, ok := item.(map[string]interface{})
		if ok && condition["type"] == "GrafanaReady" && condition["status"] == "True" {
			return true
		}
	}
	return false
}
