package main

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	liteLLMName           = "foundation-ai-litellm"
	langfuseName          = "foundation-ai-langfuse"
	langfuseWorkerName    = "foundation-ai-langfuse-worker"
	langfuseClickhouse    = "foundation-ai-langfuse-clickhouse"
	aiRuntimeSecret       = "foundation-ai-runtime"
	liteLLMPostgresClaim  = "foundation-ai-litellm-pg"
	langfusePostgresClaim = "foundation-ai-langfuse-pg"
	langfuseValkeyClaim   = "foundation-ai-langfuse-valkey"
	langfuseBucketClaim   = "foundation-ai-langfuse-events"
	langfuseAccessClaim   = "foundation-ai-langfuse-events-access"
)

func aiLabels(engine, name string) map[string]interface{} {
	return map[string]interface{}{"app.kubernetes.io/name": name, lblEngine: engine}
}

func aiConfigMap(name, namespace, owner, engine string, data map[string]interface{}) *unstructured.Unstructured {
	u := object(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, namespace, name)
	u.Object["data"] = data
	u.SetLabels(mapStringString(aiLabels(engine, name)))
	stampLabels(u, "ai", owner)
	return u
}

func aiService(name, namespace, owner, engine string, ports []interface{}) *unstructured.Unstructured {
	labels := aiLabels(engine, name)
	u := object(schema.GroupVersionKind{Version: "v1", Kind: "Service"}, namespace, name)
	u.Object["spec"] = map[string]interface{}{"selector": labels, "ports": ports}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "ai", owner)
	return u
}

func aiDeployment(name, namespace, owner, engine string, replicas int64, containers []interface{}, volumes []interface{}) *unstructured.Unstructured {
	labels := aiLabels(engine, name)
	u := object(depGVK, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"replicas": replicas,
		"selector": map[string]interface{}{"matchLabels": labels},
		"strategy": map[string]interface{}{"type": "RollingUpdate", "rollingUpdate": map[string]interface{}{"maxUnavailable": int64(0), "maxSurge": int64(1)}},
		"template": map[string]interface{}{
			"metadata": map[string]interface{}{"labels": labels},
			"spec": map[string]interface{}{
				"automountServiceAccountToken": false,
				"imagePullSecrets":             []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
				"securityContext":              map[string]interface{}{"runAsNonRoot": true, "seccompProfile": map[string]interface{}{"type": "RuntimeDefault"}},
				"containers":                   containers,
				"volumes":                      volumes,
			},
		},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "ai", owner)
	return u
}

func aiNetworkPolicy(name, namespace, owner, engine string, ports ...int64) *unstructured.Unstructured {
	labels := aiLabels(engine, name)
	allowed := make([]interface{}, 0, len(ports))
	for _, port := range ports {
		allowed = append(allowed, map[string]interface{}{"protocol": "TCP", "port": port})
	}
	u := object(schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"}, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"podSelector": map[string]interface{}{"matchLabels": labels},
		"policyTypes": []interface{}{"Ingress"},
		"ingress":     []interface{}{map[string]interface{}{"ports": allowed}},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "ai", owner)
	return u
}

func secretEnv(name, secret, key string) map[string]interface{} {
	return map[string]interface{}{"name": name, "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": secret, "key": key}}}
}

func literalEnv(name, value string) map[string]interface{} {
	return map[string]interface{}{"name": name, "value": value}
}

func hardenedContainer(name, image string, port int64, env, args, mounts []interface{}) map[string]interface{} {
	container := map[string]interface{}{
		"name": name, "image": image,
		"ports": []interface{}{map[string]interface{}{"name": "http", "containerPort": port}},
		"env":   env, "args": args,
		"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "100m", "memory": "256Mi"}, "limits": map[string]interface{}{"cpu": "1", "memory": "1Gi"}},
		"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
		"readinessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/api/public/health", "port": "http"}, "initialDelaySeconds": int64(10), "periodSeconds": int64(10)},
		"livenessProbe":   map[string]interface{}{"httpGet": map[string]interface{}{"path": "/api/public/health", "port": "http"}, "initialDelaySeconds": int64(30), "periodSeconds": int64(20)},
	}
	if mounts != nil {
		container["volumeMounts"] = mounts
	}
	return container
}

func buildLiteLLMBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	config := `model_list: []
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
  disable_spend_logs: false
litellm_settings:
  telemetry: false
`
	container := hardenedContainer("litellm", cfg.litellmImage, 4000,
		[]interface{}{secretEnv("DATABASE_URL", liteLLMPostgresClaim+"-binding", "uri"), secretEnv("LITELLM_MASTER_KEY", aiRuntimeSecret, "litellm-master-key")},
		[]interface{}{"--config", "/app/config.yaml", "--port", "4000"},
		[]interface{}{map[string]interface{}{"name": "config", "mountPath": "/app/config.yaml", "subPath": "config.yaml", "readOnly": true}},
	)
	container["readinessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": "/health/readiness", "port": "http"}, "initialDelaySeconds": int64(15), "periodSeconds": int64(10)}
	container["livenessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": "/health/liveliness", "port": "http"}, "initialDelaySeconds": int64(40), "periodSeconds": int64(20)}
	return []*unstructured.Unstructured{
		postgresDependencyClaim(ns, liteLLMPostgresClaim, "ai", "litellm", "litellm", "litellm"),
		aiConfigMap(liteLLMName+"-config", ns, owner, "litellm", map[string]interface{}{"config.yaml": config}),
		aiDeployment(liteLLMName, ns, owner, "litellm", 2, []interface{}{container}, []interface{}{map[string]interface{}{"name": "config", "configMap": map[string]interface{}{"name": liteLLMName + "-config"}}}),
		aiService(liteLLMName, ns, owner, "litellm", []interface{}{map[string]interface{}{"name": "http", "port": int64(4000), "targetPort": "http"}}),
		aiNetworkPolicy(liteLLMName, ns, owner, "litellm", 4000),
	}
}

func buildLangfuseBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	valkeySecret := langfuseValkeyClaim + valkeyCredentialSuffix
	rustfsSecret := langfuseAccessClaim + rustFSCredentialSuffix
	postgresSecret := langfusePostgresClaim + "-binding"
	sharedEnv := []interface{}{
		secretEnv("DATABASE_URL", postgresSecret, "uri"),
		secretEnv("NEXTAUTH_SECRET", aiRuntimeSecret, "langfuse-nextauth-secret"),
		secretEnv("SALT", aiRuntimeSecret, "langfuse-salt"),
		secretEnv("ENCRYPTION_KEY", aiRuntimeSecret, "langfuse-encryption-key"),
		secretEnv("LANGFUSE_INIT_ORG_ID", aiRuntimeSecret, "langfuse-init-org-id"),
		secretEnv("LANGFUSE_INIT_ORG_NAME", aiRuntimeSecret, "langfuse-init-org-name"),
		secretEnv("LANGFUSE_INIT_PROJECT_ID", aiRuntimeSecret, "langfuse-init-project-id"),
		secretEnv("LANGFUSE_INIT_PROJECT_NAME", aiRuntimeSecret, "langfuse-init-project-name"),
		secretEnv("LANGFUSE_INIT_PROJECT_PUBLIC_KEY", aiRuntimeSecret, "langfuse-init-project-public-key"),
		secretEnv("LANGFUSE_INIT_PROJECT_SECRET_KEY", aiRuntimeSecret, "langfuse-init-project-secret-key"),
		literalEnv("NEXTAUTH_URL", "http://"+langfuseName+"."+ns+".svc:3000"),
		literalEnv("CLICKHOUSE_URL", "http://"+langfuseClickhouse+"."+ns+".svc:8123"),
		literalEnv("CLICKHOUSE_MIGRATION_URL", "clickhouse://"+langfuseClickhouse+"."+ns+".svc:9000"),
		literalEnv("CLICKHOUSE_USER", "langfuse"),
		secretEnv("CLICKHOUSE_PASSWORD", aiRuntimeSecret, "clickhouse-password"),
		literalEnv("CLICKHOUSE_CLUSTER_ENABLED", "false"),
		secretEnv("REDIS_AUTH", valkeySecret, "password"),
		secretEnv("REDIS_USERNAME", valkeySecret, "username"),
		literalEnv("REDIS_HOST", valkeyName+"."+ns+".svc"),
		literalEnv("REDIS_PORT", "6379"),
		literalEnv("LANGFUSE_S3_EVENT_UPLOAD_BUCKET", "opensphere-langfuse-events"),
		literalEnv("LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT", "http://"+rustfsName+"."+ns+".svc:9000"),
		literalEnv("LANGFUSE_S3_EVENT_UPLOAD_REGION", rustFSDefaultRegion),
		literalEnv("LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE", "true"),
		secretEnv("LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID", rustfsSecret, "access_key"),
		secretEnv("LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY", rustfsSecret, "secret_key"),
		literalEnv("TELEMETRY_ENABLED", "false"),
	}
	web := hardenedContainer("langfuse", cfg.langfuseImage, 3000, sharedEnv, nil, nil)
	worker := hardenedContainer("langfuse-worker", cfg.langfuseWorkerImage, 3030, sharedEnv, nil, nil)
	worker["readinessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": "/api/health", "port": "http"}, "initialDelaySeconds": int64(20), "periodSeconds": int64(10)}
	worker["livenessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": "/api/health", "port": "http"}, "initialDelaySeconds": int64(50), "periodSeconds": int64(20)}

	clickhouseLabels := aiLabels("langfuse", langfuseClickhouse)
	clickhouse := object(statefulSetGVK, ns, langfuseClickhouse)
	clickhouse.Object["spec"] = map[string]interface{}{
		"serviceName": langfuseClickhouse, "replicas": int64(1),
		"selector": map[string]interface{}{"matchLabels": clickhouseLabels},
		"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": clickhouseLabels}, "spec": map[string]interface{}{
			"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
			"securityContext":  map[string]interface{}{"runAsNonRoot": true, "runAsUser": int64(101), "runAsGroup": int64(101), "fsGroup": int64(101)},
			"containers": []interface{}{map[string]interface{}{
				"name": "clickhouse", "image": cfg.clickhouseImage,
				"ports":           []interface{}{map[string]interface{}{"name": "http", "containerPort": int64(8123)}, map[string]interface{}{"name": "native", "containerPort": int64(9000)}},
				"env":             []interface{}{literalEnv("CLICKHOUSE_USER", "langfuse"), secretEnv("CLICKHOUSE_PASSWORD", aiRuntimeSecret, "clickhouse-password"), literalEnv("CLICKHOUSE_DB", "default")},
				"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "250m", "memory": "512Mi"}, "limits": map[string]interface{}{"cpu": "2", "memory": "2Gi"}},
				"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}, "readOnlyRootFilesystem": false},
				"volumeMounts":    []interface{}{map[string]interface{}{"name": "data", "mountPath": "/var/lib/clickhouse"}},
				"readinessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/ping", "port": "http"}, "initialDelaySeconds": int64(15), "periodSeconds": int64(10)},
			}},
		}},
		"volumeClaimTemplates": []interface{}{map[string]interface{}{"metadata": map[string]interface{}{"name": "data", "labels": map[string]interface{}{lblEngine: "langfuse"}}, "spec": map[string]interface{}{"accessModes": []interface{}{"ReadWriteOnce"}, "storageClassName": readHostRequirements(fm, cfg).StorageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": "20Gi"}}}}},
	}
	clickhouse.SetLabels(mapStringString(clickhouseLabels))
	stampLabels(clickhouse, "ai", owner)

	return []*unstructured.Unstructured{
		postgresDependencyClaim(ns, langfusePostgresClaim, "ai", "langfuse", "langfuse", "langfuse"),
		foundationDependencyClaim(ns, langfuseValkeyClaim, "ai", "langfuse", "data", "valkey", "Access", map[string]interface{}{"access": "ReadWrite"}),
		foundationDependencyClaim(ns, langfuseBucketClaim, "ai", "langfuse", "data", "rustfs", "Bucket", map[string]interface{}{"bucket": "opensphere-langfuse-events"}),
		foundationDependencyClaim(ns, langfuseAccessClaim, "ai", "langfuse", "data", "rustfs", "Access", map[string]interface{}{"bucket": "opensphere-langfuse-events", "access": "ReadWrite"}),
		clickhouse,
		aiService(langfuseClickhouse, ns, owner, "langfuse", []interface{}{map[string]interface{}{"name": "http", "port": int64(8123), "targetPort": "http"}, map[string]interface{}{"name": "native", "port": int64(9000), "targetPort": "native"}}),
		aiDeployment(langfuseName, ns, owner, "langfuse", 2, []interface{}{web}, nil),
		aiService(langfuseName, ns, owner, "langfuse", []interface{}{map[string]interface{}{"name": "http", "port": int64(3000), "targetPort": "http"}}),
		aiNetworkPolicy(langfuseName, ns, owner, "langfuse", 3000),
		aiDeployment(langfuseWorkerName, ns, owner, "langfuse", 2, []interface{}{worker}, nil),
	}
}

func buildAIBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	objects := []*unstructured.Unstructured{}
	if engineEnabled(fm, "litellm") {
		objects = append(objects, buildLiteLLMBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "langfuse") {
		objects = append(objects, buildLangfuseBundle(cfg, fm)...)
	}
	return objects, nil
}

func aiReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	if engineEnabled(fm, "litellm") && !r.deploymentReady(ctx, liteLLMName) {
		return false
	}
	if engineEnabled(fm, "langfuse") {
		if !r.deploymentReady(ctx, langfuseName) || !r.deploymentReady(ctx, langfuseWorkerName) || !r.statefulSetReady(ctx, langfuseClickhouse) {
			return false
		}
	}
	return true
}

func aiGone(ctx context.Context, r *modelReconciler, _ *unstructured.Unstructured) bool {
	for _, item := range []struct {
		gvk  schema.GroupVersionKind
		name string
	}{{depGVK, liteLLMName}, {depGVK, langfuseName}, {depGVK, langfuseWorkerName}, {statefulSetGVK, langfuseClickhouse}} {
		o := gvkObj(item.gvk)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: item.name}, o); err == nil {
			return false
		}
	}
	return true
}

func observeAI(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, _ bool) ([]interface{}, map[string]interface{}) {
	observed := []interface{}{}
	for _, item := range []struct {
		engine   string
		ready    func() bool
		endpoint string
	}{
		{"litellm", func() bool { return r.deploymentReady(ctx, liteLLMName) }, fmt.Sprintf("http://%s.%s.svc:4000", liteLLMName, r.cfg.managedNS)},
		{"langfuse", func() bool {
			return r.deploymentReady(ctx, langfuseName) && r.deploymentReady(ctx, langfuseWorkerName) && r.statefulSetReady(ctx, langfuseClickhouse)
		}, fmt.Sprintf("http://%s.%s.svc:3000", langfuseName, r.cfg.managedNS)},
	} {
		enabled, ready := engineEnabled(fm, item.engine), false
		if enabled {
			ready = item.ready()
		}
		value := "disabled"
		if enabled && ready {
			value = "1"
		} else if enabled {
			value = "0"
		}
		observed = append(observed, map[string]interface{}{"id": item.engine + "_up", "unit": "bool", "value": value, "healthy": ready, "source": "operator workload readiness"}, map[string]interface{}{"id": item.engine + "_endpoint", "unit": "", "value": item.endpoint, "healthy": ready, "source": "cluster Service discovery"})
	}
	return observed, nil
}

func aiEndpoint(cfg *config) string {
	return fmt.Sprintf("http://%s.%s.svc:4000", liteLLMName, cfg.managedNS)
}
func aiProbe(cfg *config) string { return fmt.Sprintf("%s.%s.svc:4000", liteLLMName, cfg.managedNS) }
