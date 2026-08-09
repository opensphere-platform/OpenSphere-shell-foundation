package main

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	stalwartName               = "foundation-communication-stalwart"
	novuAPIName                = "foundation-communication-novu-api"
	novuWorkerName             = "foundation-communication-novu-worker"
	novuWSName                 = "foundation-communication-novu-ws"
	novuDashboardName          = "foundation-communication-novu-dashboard"
	mattermostName             = "foundation-communication-mattermost"
	communicationRuntimeSecret = "foundation-communication-runtime"
	novuMongoClaim             = "foundation-communication-novu-mongo"
	novuValkeyClaim            = "foundation-communication-novu-valkey"
	mattermostPostgresClaim    = "foundation-communication-mattermost-pg"
	mattermostBucketClaim      = "foundation-communication-mattermost-files"
	mattermostAccessClaim      = "foundation-communication-mattermost-files-access"
)

func communicationLabels(engine, name string) map[string]interface{} {
	return map[string]interface{}{"app.kubernetes.io/name": name, lblEngine: engine}
}

func communicationService(name, namespace, owner, engine string, selector map[string]interface{}, ports []interface{}) *unstructured.Unstructured {
	u := object(schema.GroupVersionKind{Version: "v1", Kind: "Service"}, namespace, name)
	u.Object["spec"] = map[string]interface{}{"selector": selector, "ports": ports}
	u.SetLabels(mapStringString(communicationLabels(engine, name)))
	stampLabels(u, "communication", owner)
	return u
}

func communicationDeployment(name, namespace, owner, engine string, replicas int64, containers []interface{}) *unstructured.Unstructured {
	labels := communicationLabels(engine, name)
	u := object(depGVK, namespace, name)
	u.Object["spec"] = map[string]interface{}{
		"replicas": replicas,
		"selector": map[string]interface{}{"matchLabels": labels},
		"strategy": map[string]interface{}{"type": "RollingUpdate", "rollingUpdate": map[string]interface{}{"maxUnavailable": int64(0), "maxSurge": int64(1)}},
		"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}, "spec": map[string]interface{}{
			"automountServiceAccountToken": false,
			"imagePullSecrets":             []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
			"securityContext":              map[string]interface{}{"runAsNonRoot": true, "seccompProfile": map[string]interface{}{"type": "RuntimeDefault"}},
			"containers":                   containers,
		}},
	}
	u.SetLabels(mapStringString(labels))
	stampLabels(u, "communication", owner)
	return u
}

func communicationNetworkPolicy(name, namespace, owner, engine string, selector map[string]interface{}, ports ...int64) *unstructured.Unstructured {
	allowed := make([]interface{}, 0, len(ports))
	for _, port := range ports {
		allowed = append(allowed, map[string]interface{}{"protocol": "TCP", "port": port})
	}
	u := object(schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"}, namespace, name)
	u.Object["spec"] = map[string]interface{}{"podSelector": map[string]interface{}{"matchLabels": selector}, "policyTypes": []interface{}{"Ingress"}, "ingress": []interface{}{map[string]interface{}{"ports": allowed}}}
	u.SetLabels(mapStringString(communicationLabels(engine, name)))
	stampLabels(u, "communication", owner)
	return u
}

func communicationContainer(name, image string, port int64, env []interface{}, healthPath string) map[string]interface{} {
	container := map[string]interface{}{
		"name": name, "image": image,
		"env":             env,
		"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "100m", "memory": "256Mi"}, "limits": map[string]interface{}{"cpu": "1", "memory": "1Gi"}},
		"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
	}
	if port > 0 {
		container["ports"] = []interface{}{map[string]interface{}{"name": "http", "containerPort": port}}
	}
	if healthPath != "" {
		container["readinessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": healthPath, "port": "http"}, "initialDelaySeconds": int64(15), "periodSeconds": int64(10)}
		container["livenessProbe"] = map[string]interface{}{"httpGet": map[string]interface{}{"path": healthPath, "port": "http"}, "initialDelaySeconds": int64(45), "periodSeconds": int64(20)}
	}
	return container
}

func buildStalwartBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	labels := communicationLabels("stalwart", stalwartName)
	configMap := object(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, ns, stalwartName+"-config")
	configMap.Object["data"] = map[string]interface{}{
		// Mutable settings live in Stalwart's data store.  The immutable
		// bootstrap contract only selects the durable data-store location.
		"config.json": `{"@type":"RocksDb","path":"/var/lib/stalwart"}`,
	}
	configMap.SetLabels(mapStringString(labels))
	stampLabels(configMap, "communication", owner)
	container := map[string]interface{}{
		"name": "stalwart", "image": cfg.stalwartImage,
		"env": []interface{}{secretEnv("STALWART_RECOVERY_ADMIN", communicationRuntimeSecret, "stalwart-recovery-admin"), literalEnv("STALWART_PUBLIC_URL", "http://"+stalwartName+"."+ns+".svc:8080")},
		"ports": []interface{}{
			map[string]interface{}{"name": "http", "containerPort": int64(8080)}, map[string]interface{}{"name": "https", "containerPort": int64(443)},
			map[string]interface{}{"name": "smtp", "containerPort": int64(25)}, map[string]interface{}{"name": "submission", "containerPort": int64(587)},
			map[string]interface{}{"name": "submissions", "containerPort": int64(465)}, map[string]interface{}{"name": "imap", "containerPort": int64(143)}, map[string]interface{}{"name": "imaps", "containerPort": int64(993)},
		},
		"resources": map[string]interface{}{"requests": map[string]interface{}{"cpu": "250m", "memory": "512Mi"}, "limits": map[string]interface{}{"cpu": "2", "memory": "2Gi"}},
		// The upstream binary carries cap_net_bind_service for its low mail ports.
		"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "runAsUser": int64(2000), "runAsGroup": int64(2000), "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}, "add": []interface{}{"NET_BIND_SERVICE"}}},
		"volumeMounts": []interface{}{
			map[string]interface{}{"name": "config", "mountPath": "/etc/stalwart/config.json", "subPath": "config.json", "readOnly": true},
			map[string]interface{}{"name": "data", "mountPath": "/var/lib/stalwart"},
		},
		"readinessProbe": map[string]interface{}{"httpGet": map[string]interface{}{"path": "/login", "port": "http"}, "initialDelaySeconds": int64(20), "periodSeconds": int64(10)},
		"livenessProbe":  map[string]interface{}{"tcpSocket": map[string]interface{}{"port": "http"}, "initialDelaySeconds": int64(60), "periodSeconds": int64(20)},
	}
	sts := object(statefulSetGVK, ns, stalwartName)
	sts.Object["spec"] = map[string]interface{}{
		"serviceName": stalwartName, "replicas": int64(1), "selector": map[string]interface{}{"matchLabels": labels},
		"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}, "spec": map[string]interface{}{
			"automountServiceAccountToken": false, "imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
			"securityContext": map[string]interface{}{"runAsNonRoot": true, "runAsUser": int64(2000), "runAsGroup": int64(2000), "fsGroup": int64(2000), "seccompProfile": map[string]interface{}{"type": "RuntimeDefault"}},
			"containers":      []interface{}{container},
			"volumes":         []interface{}{map[string]interface{}{"name": "config", "configMap": map[string]interface{}{"name": stalwartName + "-config"}}},
		}},
		"volumeClaimTemplates": []interface{}{map[string]interface{}{"metadata": map[string]interface{}{"name": "data", "labels": map[string]interface{}{lblEngine: "stalwart"}}, "spec": map[string]interface{}{"accessModes": []interface{}{"ReadWriteOnce"}, "storageClassName": readHostRequirements(fm, cfg).StorageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": "20Gi"}}}}},
	}
	sts.SetLabels(mapStringString(labels))
	stampLabels(sts, "communication", owner)
	return []*unstructured.Unstructured{
		configMap,
		sts,
		communicationService(stalwartName, ns, owner, "stalwart", labels, []interface{}{
			map[string]interface{}{"name": "http", "port": int64(8080), "targetPort": "http"}, map[string]interface{}{"name": "https", "port": int64(443), "targetPort": "https"},
			map[string]interface{}{"name": "smtp", "port": int64(25), "targetPort": "smtp"}, map[string]interface{}{"name": "submission", "port": int64(587), "targetPort": "submission"}, map[string]interface{}{"name": "submissions", "port": int64(465), "targetPort": "submissions"}, map[string]interface{}{"name": "imap", "port": int64(143), "targetPort": "imap"}, map[string]interface{}{"name": "imaps", "port": int64(993), "targetPort": "imaps"},
		}),
		communicationNetworkPolicy(stalwartName, ns, owner, "stalwart", labels, 8080, 443, 25, 587, 465, 143, 993),
	}
}

func buildNovuBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	mongoSecret := novuMongoClaim + "-psmdb-access"
	valkeySecret := novuValkeyClaim + valkeyCredentialSuffix
	common := []interface{}{
		secretEnv("MONGO_URL", mongoSecret, "uri"), secretEnv("JWT_SECRET", communicationRuntimeSecret, "novu-jwt-secret"), secretEnv("STORE_ENCRYPTION_KEY", communicationRuntimeSecret, "novu-encryption-key"), secretEnv("NOVU_SECRET_KEY", communicationRuntimeSecret, "novu-secret-key"),
		literalEnv("REDIS_HOST", valkeyName+"."+ns+".svc"), literalEnv("REDIS_PORT", "6379"), secretEnv("REDIS_PASSWORD", valkeySecret, "password"),
		literalEnv("REDIS_CACHE_SERVICE_HOST", valkeyName+"."+ns+".svc"), literalEnv("REDIS_CACHE_SERVICE_PORT", "6379"),
		literalEnv("API_ROOT_URL", "http://"+novuAPIName+"."+ns+".svc:3000"), literalEnv("FRONT_BASE_URL", "http://"+novuDashboardName+"."+ns+".svc:4200"), literalEnv("WS_URL", "http://"+novuWSName+"."+ns+".svc:3002"),
		literalEnv("NOVU_TELEMETRY", "false"),
	}
	api := communicationContainer("novu-api", cfg.novuAPIImage, 3000, common, "/v1/health-check")
	worker := communicationContainer("novu-worker", cfg.novuWorkerImage, 0, common, "")
	ws := communicationContainer("novu-ws", cfg.novuWSImage, 3002, common, "/health-check")
	dashboard := communicationContainer("novu-dashboard", cfg.novuDashboardImage, 4200, []interface{}{literalEnv("REACT_APP_API_URL", "http://"+novuAPIName+"."+ns+".svc:3000"), literalEnv("REACT_APP_WS_URL", "http://"+novuWSName+"."+ns+".svc:3002")}, "/")
	return []*unstructured.Unstructured{
		foundationDependencyClaim(ns, novuMongoClaim, "communication", "novu", "data", "percona-psmdb", "Access", map[string]interface{}{"database": "novu", "access": "ReadWrite"}),
		foundationDependencyClaim(ns, novuValkeyClaim, "communication", "novu", "data", "valkey", "Access", map[string]interface{}{"access": "ReadWrite"}),
		communicationDeployment(novuAPIName, ns, owner, "novu", 2, []interface{}{api}),
		communicationService(novuAPIName, ns, owner, "novu", communicationLabels("novu", novuAPIName), []interface{}{map[string]interface{}{"name": "http", "port": int64(3000), "targetPort": "http"}}),
		communicationDeployment(novuWorkerName, ns, owner, "novu", 2, []interface{}{worker}),
		communicationDeployment(novuWSName, ns, owner, "novu", 2, []interface{}{ws}),
		communicationService(novuWSName, ns, owner, "novu", communicationLabels("novu", novuWSName), []interface{}{map[string]interface{}{"name": "http", "port": int64(3002), "targetPort": "http"}}),
		communicationDeployment(novuDashboardName, ns, owner, "novu", 2, []interface{}{dashboard}),
		communicationService(novuDashboardName, ns, owner, "novu", communicationLabels("novu", novuDashboardName), []interface{}{map[string]interface{}{"name": "http", "port": int64(4200), "targetPort": "http"}}),
		communicationNetworkPolicy(novuAPIName, ns, owner, "novu", communicationLabels("novu", novuAPIName), 3000),
		communicationNetworkPolicy(novuWSName, ns, owner, "novu", communicationLabels("novu", novuWSName), 3002),
		communicationNetworkPolicy(novuDashboardName, ns, owner, "novu", communicationLabels("novu", novuDashboardName), 4200),
	}
}

func buildMattermostBundle(cfg *config, fm *unstructured.Unstructured) []*unstructured.Unstructured {
	ns, owner := cfg.managedNS, fm.GetName()
	rustfsSecret := mattermostAccessClaim + rustFSCredentialSuffix
	env := []interface{}{
		literalEnv("MM_SQLSETTINGS_DRIVERNAME", "postgres"), secretEnv("MM_SQLSETTINGS_DATASOURCE", mattermostPostgresClaim+"-binding", "uri"),
		literalEnv("MM_SERVICESETTINGS_SITEURL", "http://"+mattermostName+"."+ns+".svc:8065"),
		literalEnv("MM_SERVICESETTINGS_ENABLEBOTACCOUNTCREATION", "true"), literalEnv("MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS", "true"),
		literalEnv("MM_FILESETTINGS_DRIVERNAME", "amazons3"), literalEnv("MM_FILESETTINGS_AMAZONS3ENDPOINT", rustfsName+"."+ns+".svc:9000"), literalEnv("MM_FILESETTINGS_AMAZONS3BUCKET", "opensphere-mattermost-files"), literalEnv("MM_FILESETTINGS_AMAZONS3REGION", rustFSDefaultRegion), literalEnv("MM_FILESETTINGS_AMAZONS3SSL", "false"),
		secretEnv("MM_FILESETTINGS_AMAZONS3ACCESSKEYID", rustfsSecret, "access_key"), secretEnv("MM_FILESETTINGS_AMAZONSECRETACCESSKEY", rustfsSecret, "secret_key"),
	}
	container := communicationContainer("mattermost", cfg.mattermostImage, 8065, env, "/api/v4/system/ping")
	container["volumeMounts"] = []interface{}{map[string]interface{}{"name": "config", "mountPath": "/mattermost/config"}, map[string]interface{}{"name": "logs", "mountPath": "/mattermost/logs"}}
	labels := communicationLabels("mattermost", mattermostName)
	deployment := communicationDeployment(mattermostName, ns, owner, "mattermost", 2, []interface{}{container})
	_ = unstructured.SetNestedSlice(deployment.Object, []interface{}{map[string]interface{}{"name": "config", "emptyDir": map[string]interface{}{}}, map[string]interface{}{"name": "logs", "emptyDir": map[string]interface{}{}}}, "spec", "template", "spec", "volumes")
	return []*unstructured.Unstructured{
		postgresDependencyClaim(ns, mattermostPostgresClaim, "communication", "mattermost", "mattermost", "mattermost"),
		foundationDependencyClaim(ns, mattermostBucketClaim, "communication", "mattermost", "data", "rustfs", "Bucket", map[string]interface{}{"bucket": "opensphere-mattermost-files"}),
		foundationDependencyClaim(ns, mattermostAccessClaim, "communication", "mattermost", "data", "rustfs", "Access", map[string]interface{}{"bucket": "opensphere-mattermost-files", "access": "ReadWrite"}),
		deployment,
		communicationService(mattermostName, ns, owner, "mattermost", labels, []interface{}{map[string]interface{}{"name": "http", "port": int64(8065), "targetPort": "http"}}),
		communicationNetworkPolicy(mattermostName, ns, owner, "mattermost", labels, 8065),
	}
}

func buildCommunicationBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	objects := []*unstructured.Unstructured{}
	if engineEnabled(fm, "stalwart") {
		objects = append(objects, buildStalwartBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "novu") {
		objects = append(objects, buildNovuBundle(cfg, fm)...)
	}
	if engineEnabled(fm, "mattermost") {
		objects = append(objects, buildMattermostBundle(cfg, fm)...)
	}
	return objects, nil
}

func communicationReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	if engineEnabled(fm, "stalwart") && !r.statefulSetReady(ctx, stalwartName) {
		return false
	}
	if engineEnabled(fm, "novu") && (!r.deploymentReady(ctx, novuAPIName) || !r.deploymentReady(ctx, novuWorkerName) || !r.deploymentReady(ctx, novuWSName) || !r.deploymentReady(ctx, novuDashboardName)) {
		return false
	}
	if engineEnabled(fm, "mattermost") && !r.deploymentReady(ctx, mattermostName) {
		return false
	}
	return true
}

func communicationGone(ctx context.Context, r *modelReconciler, _ *unstructured.Unstructured) bool {
	for _, item := range []struct {
		gvk  schema.GroupVersionKind
		name string
	}{{statefulSetGVK, stalwartName}, {depGVK, novuAPIName}, {depGVK, novuWorkerName}, {depGVK, novuWSName}, {depGVK, novuDashboardName}, {depGVK, mattermostName}} {
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: item.name}, gvkObj(item.gvk)); err == nil {
			return false
		}
	}
	return true
}

func observeCommunication(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, _ bool) ([]interface{}, map[string]interface{}) {
	checks := []struct {
		engine, endpoint string
		ready            func() bool
	}{
		{"stalwart", fmt.Sprintf("http://%s.%s.svc:8080", stalwartName, r.cfg.managedNS), func() bool { return r.statefulSetReady(ctx, stalwartName) }},
		{"novu", fmt.Sprintf("http://%s.%s.svc:3000", novuAPIName, r.cfg.managedNS), func() bool {
			return r.deploymentReady(ctx, novuAPIName) && r.deploymentReady(ctx, novuWorkerName) && r.deploymentReady(ctx, novuWSName) && r.deploymentReady(ctx, novuDashboardName)
		}},
		{"mattermost", fmt.Sprintf("http://%s.%s.svc:8065", mattermostName, r.cfg.managedNS), func() bool { return r.deploymentReady(ctx, mattermostName) }},
	}
	observed := []interface{}{}
	for _, item := range checks {
		enabled, ready := engineEnabled(fm, item.engine), false
		if enabled {
			ready = item.ready()
		}
		value := "disabled"
		if enabled {
			value = "0"
		}
		if ready {
			value = "1"
		}
		observed = append(observed, map[string]interface{}{"id": item.engine + "_up", "unit": "bool", "value": value, "healthy": ready, "source": "operator workload readiness"}, map[string]interface{}{"id": item.engine + "_endpoint", "unit": "", "value": item.endpoint, "healthy": ready, "source": "cluster Service discovery"})
	}
	return observed, nil
}

func communicationEndpoint(cfg *config) string {
	return fmt.Sprintf("http://%s.%s.svc:3000", novuAPIName, cfg.managedNS)
}
func communicationProbe(cfg *config) string {
	return fmt.Sprintf("%s.%s.svc:3000", novuAPIName, cfg.managedNS)
}
