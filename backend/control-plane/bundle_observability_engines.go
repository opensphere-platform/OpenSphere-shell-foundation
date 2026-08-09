package main

import (
	"context"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	tempoName                     = "foundation-observability-tempo"
	lokiName                      = "foundation-observability-loki"
	observabilityGatewayName      = "foundation-observability-gateway"
	observabilityTenantConfigName = "foundation-observability-tenants"
)

func observabilityLabels(engine, name string) map[string]interface{} {
	return map[string]interface{}{"app.kubernetes.io/name": name, lblEngine: engine}
}

func observabilityConfigMap(engine, name, ns, owner, key, value string) *unstructured.Unstructured {
	u := object(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, ns, name+"-config")
	u.Object["data"] = map[string]interface{}{key: value}
	u.SetLabels(mapStringString(observabilityLabels(engine, name)))
	stampLabels(u, "observability", owner)
	return u
}

func observabilityService(engine, name, ns, owner string, ports []interface{}) *unstructured.Unstructured {
	labels := observabilityLabels(engine, name)
	u := object(schema.GroupVersionKind{Version: "v1", Kind: "Service"}, ns, name)
	u.Object["spec"] = map[string]interface{}{"selector": labels, "ports": ports}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "observability", owner)
	return u
}

func observabilityIngressPolicy(engine, name, ns, owner string, ports ...int64) *unstructured.Unstructured {
	labels := observabilityLabels(engine, name)
	allowedPorts := make([]interface{}, 0, len(ports))
	for _, port := range ports {
		allowedPorts = append(allowedPorts, map[string]interface{}{"protocol": "TCP", "port": port})
	}
	u := object(schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"}, ns, name)
	u.Object["spec"] = map[string]interface{}{
		"podSelector": map[string]interface{}{"matchLabels": labels},
		"policyTypes": []interface{}{"Ingress"},
		"ingress":     []interface{}{map[string]interface{}{"ports": allowedPorts}},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "observability", owner)
	return u
}

func observabilityBackendPolicy(engine, name, ns, owner string, ports ...int64) *unstructured.Unstructured {
	labels := observabilityLabels(engine, name)
	allowedPorts := make([]interface{}, 0, len(ports))
	for _, port := range ports {
		allowedPorts = append(allowedPorts, map[string]interface{}{"protocol": "TCP", "port": port})
	}
	peers := []interface{}{
		map[string]interface{}{"podSelector": map[string]interface{}{"matchLabels": map[string]interface{}{"app.kubernetes.io/name": observabilityGatewayName}}},
		map[string]interface{}{"podSelector": map[string]interface{}{"matchLabels": map[string]interface{}{"app.kubernetes.io/name": collectorName}}},
	}
	u := object(schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"}, ns, name)
	u.Object["spec"] = map[string]interface{}{
		"podSelector": map[string]interface{}{"matchLabels": labels},
		"policyTypes": []interface{}{"Ingress"},
		"ingress":     []interface{}{map[string]interface{}{"from": peers, "ports": allowedPorts}},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "observability", owner)
	return u
}

func observabilityStatefulSet(engine, name, ns, owner, image, configKey, configPath, dataPath string, ports []interface{}, args []interface{}) *unstructured.Unstructured {
	labels := observabilityLabels(engine, name)
	u := object(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"}, ns, name)
	u.Object["spec"] = map[string]interface{}{
		"serviceName": name,
		"replicas":    int64(1),
		"selector":    map[string]interface{}{"matchLabels": labels},
		"template": map[string]interface{}{
			"metadata": map[string]interface{}{"labels": labels},
			"spec": map[string]interface{}{
				"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
				"securityContext":  map[string]interface{}{"runAsNonRoot": true, "runAsUser": int64(10001), "runAsGroup": int64(10001), "fsGroup": int64(10001)},
				"containers": []interface{}{map[string]interface{}{
					"name": engine, "image": image, "args": args, "ports": ports,
					"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "50m", "memory": "128Mi"}, "limits": map[string]interface{}{"cpu": "1", "memory": "1Gi"}},
					"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
					"readinessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/ready", "port": ports[0].(map[string]interface{})["name"]}, "periodSeconds": int64(10)},
					"livenessProbe":   map[string]interface{}{"httpGet": map[string]interface{}{"path": "/ready", "port": ports[0].(map[string]interface{})["name"]}, "periodSeconds": int64(20)},
					"volumeMounts": []interface{}{
						map[string]interface{}{"name": "config", "mountPath": configPath, "subPath": configKey, "readOnly": true},
						map[string]interface{}{"name": "data", "mountPath": dataPath},
					},
				}},
				"volumes": []interface{}{map[string]interface{}{"name": "config", "configMap": map[string]interface{}{"name": name + "-config"}}},
			},
		},
		"volumeClaimTemplates": []interface{}{map[string]interface{}{
			"metadata": map[string]interface{}{"name": "data", "labels": map[string]interface{}{lblEngine: engine}},
			"spec":     map[string]interface{}{"accessModes": []interface{}{"ReadWriteOnce"}, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": "10Gi"}}},
		}},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "observability", owner)
	return u
}

func buildTempoBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	config := `server:
  http_listen_port: 3200
multitenancy_enabled: true
distributor:
  receivers:
    otlp:
      protocols:
        grpc: { endpoint: 0.0.0.0:4317 }
        http: { endpoint: 0.0.0.0:4318 }
storage:
  trace:
    backend: local
    wal: { path: /var/tempo/wal }
    local: { path: /var/tempo/traces }
compactor:
  compaction: { block_retention: 168h }
`
	ports := []interface{}{map[string]interface{}{"name": "http", "containerPort": int64(3200)}, map[string]interface{}{"name": "otlp-grpc", "containerPort": int64(4317)}, map[string]interface{}{"name": "otlp-http", "containerPort": int64(4318)}}
	return []*unstructured.Unstructured{
		observabilityConfigMap("tempo", tempoName, cfg.managedNS, fm.GetName(), "tempo.yaml", config),
		observabilityStatefulSet("tempo", tempoName, cfg.managedNS, fm.GetName(), cfg.tempoImage, "tempo.yaml", "/etc/tempo/tempo.yaml", "/var/tempo", ports, []interface{}{"-config.file=/etc/tempo/tempo.yaml"}),
		observabilityService("tempo", tempoName, cfg.managedNS, fm.GetName(), []interface{}{
			map[string]interface{}{"name": "http", "port": int64(3200), "targetPort": "http"},
			map[string]interface{}{"name": "otlp-grpc", "port": int64(4317), "targetPort": "otlp-grpc"},
			map[string]interface{}{"name": "otlp-http", "port": int64(4318), "targetPort": "otlp-http"},
		}),
		observabilityBackendPolicy("tempo", tempoName, cfg.managedNS, fm.GetName(), 3200, 4317, 4318),
	}
}

func buildLokiBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	config := `auth_enabled: true
server:
  http_listen_port: 3100
common:
  path_prefix: /var/loki
  replication_factor: 1
  ring:
    kvstore: { store: inmemory }
schema_config:
  configs:
    - from: 2024-04-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index: { prefix: index_, period: 24h }
storage_config:
  filesystem: { directory: /var/loki/chunks }
`
	ports := []interface{}{map[string]interface{}{"name": "http", "containerPort": int64(3100)}}
	return []*unstructured.Unstructured{
		observabilityConfigMap("loki", lokiName, cfg.managedNS, fm.GetName(), "loki.yaml", config),
		observabilityStatefulSet("loki", lokiName, cfg.managedNS, fm.GetName(), cfg.lokiImage, "loki.yaml", "/etc/loki/loki.yaml", "/var/loki", ports, []interface{}{"-config.file=/etc/loki/loki.yaml"}),
		observabilityService("loki", lokiName, cfg.managedNS, fm.GetName(), []interface{}{map[string]interface{}{"name": "http", "port": int64(3100), "targetPort": "http"}}),
		observabilityBackendPolicy("loki", lokiName, cfg.managedNS, fm.GetName(), 3100),
	}
}

func buildObservabilityGatewayBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	labels := observabilityLabels("tenant-gateway", observabilityGatewayName)
	deployment := object(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, ns, observabilityGatewayName)
	deployment.Object["spec"] = map[string]interface{}{
		"replicas": int64(2), "selector": map[string]interface{}{"matchLabels": labels},
		"strategy": map[string]interface{}{"type": "RollingUpdate", "rollingUpdate": map[string]interface{}{"maxUnavailable": int64(0), "maxSurge": int64(1)}},
		"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}, "spec": map[string]interface{}{
			"automountServiceAccountToken": false,
			"imagePullSecrets":             []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
			"securityContext":              map[string]interface{}{"runAsNonRoot": true, "runAsUser": int64(65532), "runAsGroup": int64(65532), "seccompProfile": map[string]interface{}{"type": "RuntimeDefault"}},
			"containers": []interface{}{map[string]interface{}{
				"name": "gateway", "image": cfg.observabilityGatewayImage,
				"ports": []interface{}{map[string]interface{}{"name": "http", "containerPort": int64(8080)}},
				"env": []interface{}{
					literalEnv("TENANT_CONFIG_PATH", "/etc/opensphere/tenants.json"),
					literalEnv("LOKI_UPSTREAM", "http://"+lokiName+"."+ns+".svc:3100"),
					literalEnv("TEMPO_QUERY_UPSTREAM", "http://"+tempoName+"."+ns+".svc:3200"),
					literalEnv("TEMPO_OTLP_UPSTREAM", "http://"+tempoName+"."+ns+".svc:4318"),
				},
				"volumeMounts":    []interface{}{map[string]interface{}{"name": "tenants", "mountPath": "/etc/opensphere", "readOnly": true}},
				"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "20m", "memory": "32Mi"}, "limits": map[string]interface{}{"cpu": "250m", "memory": "128Mi"}},
				"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
				"readinessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/healthz", "port": "http"}, "periodSeconds": int64(10)},
				"livenessProbe":   map[string]interface{}{"httpGet": map[string]interface{}{"path": "/healthz", "port": "http"}, "periodSeconds": int64(20)},
			}},
			"volumes": []interface{}{map[string]interface{}{"name": "tenants", "configMap": map[string]interface{}{"name": observabilityTenantConfigName, "optional": true}}},
		}},
	}
	deployment.SetLabels(mapStringString(labels))
	stampLabels(deployment, "observability", owner)
	service := observabilityService("tenant-gateway", observabilityGatewayName, ns, owner, []interface{}{map[string]interface{}{"name": "http", "port": int64(8080), "targetPort": "http"}})
	policy := observabilityIngressPolicy("tenant-gateway", observabilityGatewayName, ns, owner, 8080)
	return []*unstructured.Unstructured{deployment, service, policy}
}

func observabilityReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	checks := map[string]func() bool{
		"otel":  func() bool { return r.deploymentReady(ctx, collectorName) },
		"tempo": func() bool { return r.statefulSetReady(ctx, tempoName) },
		"loki":  func() bool { return r.statefulSetReady(ctx, lokiName) },
	}
	for engine, check := range checks {
		if engineEnabled(fm, engine) && !check() {
			return false
		}
	}
	if (engineEnabled(fm, "tempo") || engineEnabled(fm, "loki")) && !r.deploymentReady(ctx, observabilityGatewayName) {
		return false
	}
	if engineEnabled(fm, "grafana-operator") {
		grafana := gvkObj(grafanaGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: grafanaName}, grafana); err != nil || !grafanaObjectReady(grafana) {
			return false
		}
	}
	return true
}

func observeObservabilityEngines(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) []interface{} {
	result := []interface{}{}
	for _, item := range []struct{ engine, name string }{{"tempo", tempoName}, {"loki", lokiName}} {
		enabled := engineEnabled(fm, item.engine)
		ready := enabled && r.statefulSetReady(ctx, item.name)
		value := "disabled"
		if enabled && ready {
			value = "1"
		} else if enabled {
			value = "0"
		}
		result = append(result, map[string]interface{}{"id": item.engine + "_up", "unit": "bool", "value": value, "healthy": ready, "source": "StatefulSet.status.readyReplicas"})
	}
	if engineEnabled(fm, "grafana-operator") {
		grafana := gvkObj(grafanaGVK)
		ready := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: grafanaName}, grafana) == nil && grafanaObjectReady(grafana)
		value := "0"
		if ready {
			value = "1"
		}
		result = append(result, map[string]interface{}{"id": "grafana_up", "unit": "bool", "value": value, "healthy": ready, "source": "Grafana.status.stage/stageStatus"})
	}
	return result
}

func (r *modelReconciler) statefulSetReady(ctx context.Context, name string) bool {
	o := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: name}, o); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(o.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(o.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired
}

func mapStringString(input map[string]interface{}) map[string]string {
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value.(string)
	}
	return output
}
