package main

// Non-PostgreSQL data engines. Every object is rendered from FoundationModel/data
// spec.parameters.dataEngines.<id> and applied through the same SSA path as PostgreSQL.

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	psmdbName  = "foundation-data-mongodb"
	valkeyName = "foundation-data-valkey"
	rustfsName = "opensphere-rustfs"
)

var psmdbGVK = schema.GroupVersionKind{Group: "psmdb.percona.com", Version: "v1", Kind: "PerconaServerMongoDB"}

type dataEngineOpts struct {
	version, image, storageClass, storageSize, resourceProfile string
	cpuRequest, memoryRequest, cpuLimit, memoryLimit           string
	authSecret, heap, persistenceMode                          string
	replicas                                                   int64
	monitoring, tls                                            bool
	backup                                                     backupOpts
}

func nestedDataEngineParams(fm *unstructured.Unstructured, id string) map[string]interface{} {
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters", "dataEngines", id)
	return p
}

func imageWithTag(base, tag string) string {
	if tag == "" {
		return base
	}
	i := strings.LastIndex(base, ":")
	if i > strings.LastIndex(base, "/") {
		base = base[:i]
	}
	return base + ":" + tag
}

func dataEngineParams(fm *unstructured.Unstructured, cfg *config, id string) dataEngineOpts {
	base := map[string]string{"psmdb": cfg.psmdbImage, "valkey": cfg.valkeyImage, "rustfs": cfg.rustfsImage, "opensearch": cfg.opensearchImage}[id]
	defVersion := map[string]string{"psmdb": "8.0", "valkey": "9.1.0", "rustfs": "1.0.0-beta.10", "opensearch": "3.7.0"}[id]
	defStorage := map[string]string{"psmdb": "20Gi", "valkey": "10Gi", "rustfs": "50Gi", "opensearch": "50Gi"}[id]
	defReplicas := int64(1)
	if id == "psmdb" {
		defReplicas = 3
	}
	o := dataEngineOpts{
		version: defVersion, image: base, storageClass: readHostRequirements(fm, cfg).StorageClass,
		storageSize: defStorage, resourceProfile: "small", cpuRequest: "250m", memoryRequest: "512Mi",
		cpuLimit: "1", memoryLimit: "1Gi", replicas: defReplicas, monitoring: false,
	}
	p := nestedDataEngineParams(fm, id)
	if p == nil {
		return o
	}
	o.version = pStr(p, "version", o.version)
	o.image = imageWithTag(base, o.version)
	o.storageClass = pStr(p, "storageClass", o.storageClass)
	o.storageSize = pStr(p, "storageSize", o.storageSize)
	o.resourceProfile = pStr(p, "resourceProfile", o.resourceProfile)
	o.cpuRequest = pStr(p, "cpuRequest", o.cpuRequest)
	o.memoryRequest = pStr(p, "memoryRequest", o.memoryRequest)
	o.cpuLimit = pStr(p, "cpuLimit", o.cpuLimit)
	o.memoryLimit = pStr(p, "memoryLimit", o.memoryLimit)
	o.authSecret = pStr(p, "authSecret", "")
	o.heap = pStr(p, "heap", "-Xms1g -Xmx1g")
	o.persistenceMode = pStr(p, "persistenceMode", "aof-everysec")
	o.replicas = pInt(p, "replicas", o.replicas)
	o.monitoring = pBool(p, "monitoring", false)
	o.tls = pBool(p, "tls", false)
	if b, ok := p["backup"].(map[string]interface{}); ok {
		o.backup = backupOpts{enabled: pBool(b, "enabled", false), endpointURL: pStr(b, "s3Endpoint", ""), destinationPath: pStr(b, "destinationPath", ""), secretName: pStr(b, "secretName", ""), retentionPolicy: pStr(b, "retentionPolicy", "30d")}
	}
	return o
}

func engineLabels(id, name string) map[string]interface{} {
	return map[string]interface{}{"app": name, "app.kubernetes.io/name": name, lblEngine: id}
}

func engineResources(o dataEngineOpts) map[string]interface{} {
	return map[string]interface{}{"requests": map[string]interface{}{"cpu": o.cpuRequest, "memory": o.memoryRequest}, "limits": map[string]interface{}{"cpu": o.cpuLimit, "memory": o.memoryLimit}}
}

func engineService(id, name, ns string, ports []interface{}, owner string) *unstructured.Unstructured {
	labels := engineLabels(id, name)
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "Service", "metadata": map[string]interface{}{"name": name, "namespace": ns, "labels": labels},
		"spec": map[string]interface{}{"selector": labels, "ports": ports},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, id)
	return u
}

func engineNetworkPolicy(id, name, ns, owner string, port int64) *unstructured.Unstructured {
	labels := engineLabels(id, name)
	allowedNamespaces := map[string]interface{}{"matchExpressions": []interface{}{map[string]interface{}{"key": "kubernetes.io/metadata.name", "operator": "In", "values": []interface{}{ns, "opensphere-console", "monitoring"}}}}
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": map[string]interface{}{"name": name + "-internal", "namespace": ns},
		"spec": map[string]interface{}{"podSelector": map[string]interface{}{"matchLabels": labels}, "policyTypes": []interface{}{"Ingress"}, "ingress": []interface{}{map[string]interface{}{"from": []interface{}{map[string]interface{}{"namespaceSelector": allowedNamespaces}}, "ports": []interface{}{map[string]interface{}{"protocol": "TCP", "port": port}}}}},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, id)
	return u
}

func engineStatefulSet(id, name, ns, owner string, o dataEngineOpts, container map[string]interface{}, dataPath string) *unstructured.Unstructured {
	labels := engineLabels(id, name)
	runAsUser := int64(10001)
	if id == "valkey" {
		runAsUser = 1000
	}
	container["image"] = o.image
	container["securityContext"] = map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "runAsUser": runAsUser, "runAsGroup": runAsUser, "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}}
	container["resources"] = engineResources(o)
	container["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": dataPath}}
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1", "kind": "StatefulSet", "metadata": map[string]interface{}{"name": name, "namespace": ns},
		"spec": map[string]interface{}{
			"serviceName": name, "replicas": o.replicas, "selector": map[string]interface{}{"matchLabels": labels},
			"template":             map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}, "spec": map[string]interface{}{"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}}, "securityContext": map[string]interface{}{"runAsNonRoot": true, "fsGroup": runAsUser, "fsGroupChangePolicy": "OnRootMismatch"}, "containers": []interface{}{container}}},
			"volumeClaimTemplates": []interface{}{map[string]interface{}{"metadata": map[string]interface{}{"name": "data", "labels": map[string]interface{}{lblEngine: id}}, "spec": map[string]interface{}{"accessModes": []interface{}{"ReadWriteOnce"}, "storageClassName": o.storageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": o.storageSize}}}}},
		},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, id)
	return u
}

func buildValkeyBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	o, ns, owner := dataEngineParams(fm, cfg, "valkey"), dataNS(cfg, fm), fm.GetName()
	if o.authSecret == "" {
		return nil, fmt.Errorf("valkey authSecret is required")
	}
	c := map[string]interface{}{
		"name": "valkey", "ports": []interface{}{map[string]interface{}{"name": "valkey", "containerPort": int64(6379)}},
		"env":     []interface{}{map[string]interface{}{"name": "VALKEY_PASSWORD", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "password"}}}},
		"command": []interface{}{"sh", "-ec"}, "args": []interface{}{`exec valkey-server --appendonly yes --appendfsync everysec --requirepass "$VALKEY_PASSWORD"`},
		"readinessProbe": map[string]interface{}{"exec": map[string]interface{}{"command": []interface{}{"sh", "-ec", `valkey-cli -a "$VALKEY_PASSWORD" ping | grep PONG`}}, "initialDelaySeconds": int64(5), "periodSeconds": int64(5)},
	}
	return []*unstructured.Unstructured{
		engineStatefulSet("valkey", valkeyName, ns, owner, o, c, "/data"),
		engineService("valkey", valkeyName, ns, []interface{}{map[string]interface{}{"name": "valkey", "port": int64(6379), "targetPort": int64(6379)}}, owner),
		engineNetworkPolicy("valkey", valkeyName, ns, owner, 6379),
	}, nil
}

func buildRustFSBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	o, ns, owner := dataEngineParams(fm, cfg, "rustfs"), dataNS(cfg, fm), fm.GetName()
	if o.authSecret == "" {
		return nil, fmt.Errorf("rustfs authSecret is required")
	}
	c := map[string]interface{}{
		"name": "rustfs", "ports": []interface{}{map[string]interface{}{"name": "s3", "containerPort": int64(9000)}, map[string]interface{}{"name": "console", "containerPort": int64(9001)}},
		"env": []interface{}{
			map[string]interface{}{"name": "RUSTFS_VOLUMES", "value": "/data"}, map[string]interface{}{"name": "RUSTFS_ADDRESS", "value": "0.0.0.0:9000"}, map[string]interface{}{"name": "RUSTFS_CONSOLE_ADDRESS", "value": "0.0.0.0:9001"}, map[string]interface{}{"name": "RUSTFS_CONSOLE_ENABLE", "value": "true"},
			map[string]interface{}{"name": "RUSTFS_ACCESS_KEY", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "access_key"}}}, map[string]interface{}{"name": "RUSTFS_SECRET_KEY", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "secret_key"}}},
		},
		"readinessProbe": map[string]interface{}{"tcpSocket": map[string]interface{}{"port": "s3"}, "initialDelaySeconds": int64(8), "periodSeconds": int64(8)},
	}
	return []*unstructured.Unstructured{
		engineStatefulSet("rustfs", rustfsName, ns, owner, o, c, "/data"),
		engineService("rustfs", rustfsName, ns, []interface{}{map[string]interface{}{"name": "s3", "port": int64(9000), "targetPort": int64(9000)}, map[string]interface{}{"name": "console", "port": int64(9001), "targetPort": int64(9001)}}, owner),
		engineNetworkPolicy("rustfs", rustfsName, ns, owner, 9000),
	}, nil
}

func buildPSMDBBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	o, ns, owner := dataEngineParams(fm, cfg, "psmdb"), dataNS(cfg, fm), fm.GetName()
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "psmdb.percona.com/v1", "kind": "PerconaServerMongoDB", "metadata": map[string]interface{}{"name": psmdbName, "namespace": ns},
		"spec": map[string]interface{}{
			"crVersion": "1.22.0", "image": o.image, "imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}}, "updateStrategy": "SmartUpdate", "upgradeOptions": map[string]interface{}{"apply": "Disabled"},
			"replsets": []interface{}{map[string]interface{}{"name": "rs0", "size": o.replicas, "resources": engineResources(o), "volumeSpec": map[string]interface{}{"persistentVolumeClaim": map[string]interface{}{"storageClassName": o.storageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": o.storageSize}}}}}},
			"sharding": map[string]interface{}{"enabled": false}, "pmm": map[string]interface{}{"enabled": false},
		},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, "psmdb")
	return []*unstructured.Unstructured{u, engineNetworkPolicy("psmdb", psmdbName, ns, owner, 27017)}, nil
}

func getEngineWorkload(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, id string) (*unstructured.Unstructured, error) {
	ns := dataNS(r.cfg, fm)
	if id == "psmdb" {
		o := gvkObj(psmdbGVK)
		return o, r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: psmdbName}, o)
	}
	name := map[string]string{"valkey": valkeyName, "rustfs": rustfsName, "opensearch": osStatefulSetName}[id]
	o := gvkObj(statefulSetGVK)
	return o, r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: name}, o)
}

func engineWorkloadReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, id string) bool {
	o, err := getEngineWorkload(ctx, r, fm, id)
	if err != nil {
		return false
	}
	if id == "psmdb" {
		state, _, _ := unstructured.NestedString(o.Object, "status", "state")
		return strings.EqualFold(state, "ready")
	}
	n, _, _ := unstructured.NestedInt64(o.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(o.Object, "status", "readyReplicas")
	return n > 0 && ready >= n
}

func engineWorkloadGone(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, id string) bool {
	_, err := getEngineWorkload(ctx, r, fm, id)
	return apierrors.IsNotFound(err)
}

func observeDataEngine(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, id string) []interface{} {
	mk := func(k, unit, val string, healthy bool, src string) map[string]interface{} {
		return map[string]interface{}{"id": k, "unit": unit, "value": val, "healthy": healthy, "source": src}
	}
	if !engineEnabled(fm, id) {
		return []interface{}{mk(id+"_up", "bool", "n/a", false, "spec.parameters.engines."+id)}
	}
	o := dataEngineParams(fm, r.cfg, id)
	ready := engineWorkloadReady(ctx, r, fm, id)
	up := "0"
	if ready {
		up = "1"
	}
	endpoint := map[string]string{"psmdb": psmdbName + "-rs0." + dataNS(r.cfg, fm) + ".svc:27017", "valkey": valkeyName + "." + dataNS(r.cfg, fm) + ".svc:6379", "rustfs": rustfsName + "." + dataNS(r.cfg, fm) + ".svc:9000"}[id]
	return []interface{}{
		mk(id+"_up", "bool", up, ready, "managed workload status"), mk(id+"_version", "", o.version, true, "spec.parameters.dataEngines."+id+".version"),
		mk(id+"_replicas", "count", fmt.Sprintf("%d", o.replicas), ready, "managed workload spec"), mk(id+"_storage", "", o.storageSize+" @ "+o.storageClass, true, "PVC template"),
		mk(id+"_endpoint", "", endpoint, endpoint != "", "Service"), mk(id+"_monitoring", "bool", boolStr(o.monitoring), true, "desired policy"),
	}
}
