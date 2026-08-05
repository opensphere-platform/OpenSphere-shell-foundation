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
	psmdbName        = "foundation-data-mongodb"
	valkeyName       = "foundation-data-valkey"
	rustfsName       = "opensphere-rustfs"
	psmdbBackupImage = "ghcr.io/opensphere-platform/mirror/percona-backup-mongodb:2.15.0@sha256:2c69ec2dbd5be02df31577869df97c72781bf6fe6456471e8087b0e03136f672"
	psmdbPMMImage    = "ghcr.io/opensphere-platform/mirror/pmm-client:3.8.1@sha256:a92cfb7f912bd85d8245575c3ee5c423664ad2baedb674d159a87b113dbd4de2"
)

var psmdbGVK = schema.GroupVersionKind{Group: "psmdb.percona.com", Version: "v1", Kind: "PerconaServerMongoDB"}

type dataEngineOpts struct {
	version, image, storageClass, storageSize, resourceProfile string
	cpuRequest, memoryRequest, cpuLimit, memoryLimit           string
	authSecret, heap, persistenceMode, maxmemoryPolicy         string
	replicas                                                   int64
	monitoring, tls                                            bool
	backup                                                     backupOpts
}

func nestedDataEngineParams(fm *unstructured.Unstructured, id string) map[string]interface{} {
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters", "dataEngines", id)
	return p
}

func imageWithTag(base, tag string) string {
	// Release가 exact digest로 고정한 canonical image는 사람이 선택한 제품
	// version으로 다시 tag 변환하지 않는다. @sha256를 ':' tag로 오인하면
	// admission의 release-pinned image 계약을 깨뜨린다.
	if tag == "" || strings.Contains(base, "@sha256:") {
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
	defVersion := map[string]string{"psmdb": "8.0.26-11", "valkey": "9.1.0", "rustfs": "1.0.0-beta.10", "opensearch": "3.7.0"}[id]
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
	// FoundationModel은 사람이 읽는 제품 버전만 보존하고, OCI 변형은
	// control-plane의 canonical mirror tag로 매핑한다.
	if id == "valkey" && o.version == "9.1.0" {
		o.image = imageWithTag(base, "9.1.0-alpine")
	}
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
	o.maxmemoryPolicy = pStr(p, "maxmemoryPolicy", "allkeys-lru")
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
	if o.replicas < 1 || o.replicas > 9 {
		return nil, fmt.Errorf("valkey replicas must be in range 1..9")
	}
	appendOnly, appendFsync := "yes", "everysec"
	switch o.persistenceMode {
	case "aof-always":
		appendFsync = "always"
	case "aof-everysec", "":
	case "rdb-aof":
	case "rdb":
		appendOnly = "no"
	default:
		return nil, fmt.Errorf("unsupported valkey persistenceMode %q", o.persistenceMode)
	}
	allowedPolicies := map[string]bool{"noeviction": true, "allkeys-lru": true, "allkeys-lfu": true, "allkeys-random": true, "volatile-lru": true, "volatile-lfu": true, "volatile-ttl": true, "volatile-random": true}
	if !allowedPolicies[o.maxmemoryPolicy] {
		return nil, fmt.Errorf("unsupported valkey maxmemoryPolicy %q", o.maxmemoryPolicy)
	}
	start := fmt.Sprintf(`
umask 077
PASS_SHA="$(printf %%s "$VALKEY_PASSWORD" | sha256sum | awk '{print $1}')"
if [ -f /data/users.acl ]; then
  grep -v '^user default ' /data/users.acl > /data/users.acl.next || true
else
  : > /data/users.acl.next
fi
{
  printf 'user default on #%%s ~* &* +@all\n' "$PASS_SHA"
  cat /data/users.acl.next
} > /data/users.acl.new
chmod 600 /data/users.acl.new
mv /data/users.acl.new /data/users.acl
rm -f /data/users.acl.next
COMMON="--bind 0.0.0.0 --port 6379 --dir /data --dbfilename dump.rdb --appenddirname appendonlydir --appendonly %s --appendfsync %s --aclfile /data/users.acl --maxmemory-policy %s"
case "$HOSTNAME" in
  *-0) exec valkey-server $COMMON ;;
  *) exec valkey-server $COMMON --replicaof %s-0.%s-headless.%s.svc 6379 --masterauth "$VALKEY_PASSWORD" --replica-read-only yes ;;
esac`, appendOnly, appendFsync, o.maxmemoryPolicy, valkeyName, valkeyName, ns)
	labels := engineLabels("valkey", valkeyName)
	passwordEnv := map[string]interface{}{"name": "VALKEY_PASSWORD", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "password"}}}
	valkey := map[string]interface{}{
		"name": "valkey", "image": o.image,
		"ports": []interface{}{map[string]interface{}{"name": "valkey", "containerPort": int64(6379)}},
		"env":   []interface{}{passwordEnv}, "command": []interface{}{"sh", "-ec"}, "args": []interface{}{start},
		"resources":       engineResources(o),
		"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "runAsUser": int64(1000), "runAsGroup": int64(1000), "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
		"volumeMounts":    []interface{}{map[string]interface{}{"name": "data", "mountPath": "/data"}},
		"startupProbe":    map[string]interface{}{"exec": map[string]interface{}{"command": []interface{}{"sh", "-ec", `valkey-cli --no-auth-warning -a "$VALKEY_PASSWORD" ping | grep -qx PONG`}}, "failureThreshold": int64(30), "periodSeconds": int64(5)},
		"readinessProbe":  map[string]interface{}{"exec": map[string]interface{}{"command": []interface{}{"sh", "-ec", `valkey-cli --no-auth-warning -a "$VALKEY_PASSWORD" ping | grep -qx PONG`}}, "periodSeconds": int64(5)},
		"livenessProbe":   map[string]interface{}{"exec": map[string]interface{}{"command": []interface{}{"sh", "-ec", `valkey-cli --no-auth-warning -a "$VALKEY_PASSWORD" ping | grep -qx PONG`}}, "periodSeconds": int64(10), "failureThreshold": int64(6)},
	}
	containers := []interface{}{valkey}
	if o.monitoring {
		containers = append(containers, map[string]interface{}{
			"name": "metrics", "image": cfg.valkeyExporterImage,
			"ports":           []interface{}{map[string]interface{}{"name": "metrics", "containerPort": int64(9121)}},
			"env":             []interface{}{map[string]interface{}{"name": "REDIS_ADDR", "value": "redis://127.0.0.1:6379"}, map[string]interface{}{"name": "REDIS_PASSWORD", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "password"}}}},
			"args":            []interface{}{`--redis.addr=redis://127.0.0.1:6379`, `--web.listen-address=:9121`},
			"resources":       map[string]interface{}{"requests": map[string]interface{}{"cpu": "25m", "memory": "32Mi"}, "limits": map[string]interface{}{"cpu": "200m", "memory": "128Mi"}},
			"securityContext": map[string]interface{}{"allowPrivilegeEscalation": false, "runAsNonRoot": true, "runAsUser": int64(59000), "runAsGroup": int64(59000), "capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}}},
			"readinessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/metrics", "port": "metrics"}, "periodSeconds": int64(10)},
		})
	}
	sts := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1", "kind": "StatefulSet", "metadata": map[string]interface{}{"name": valkeyName, "namespace": ns},
		"spec": map[string]interface{}{
			"serviceName": valkeyName + "-headless", "replicas": o.replicas, "selector": map[string]interface{}{"matchLabels": labels},
			"updateStrategy": map[string]interface{}{"type": "RollingUpdate"},
			"template": map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}, "spec": map[string]interface{}{
				"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}}, "terminationGracePeriodSeconds": int64(60),
				"securityContext": map[string]interface{}{"runAsNonRoot": true, "fsGroup": int64(1000), "fsGroupChangePolicy": "OnRootMismatch"},
				"affinity":        map[string]interface{}{"podAntiAffinity": map[string]interface{}{"preferredDuringSchedulingIgnoredDuringExecution": []interface{}{map[string]interface{}{"weight": int64(100), "podAffinityTerm": map[string]interface{}{"labelSelector": map[string]interface{}{"matchLabels": labels}, "topologyKey": "kubernetes.io/hostname"}}}}},
				"containers":      containers,
			}},
			"volumeClaimTemplates": []interface{}{map[string]interface{}{"metadata": map[string]interface{}{"name": "data", "labels": map[string]interface{}{lblEngine: "valkey"}}, "spec": map[string]interface{}{"accessModes": []interface{}{"ReadWriteOnce"}, "storageClassName": o.storageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": o.storageSize}}}}},
		},
	}}
	stampLabels(sts, "data", owner)
	markEngine(sts, "valkey")
	objects := []*unstructured.Unstructured{
		sts,
		valkeyService(valkeyName+"-headless", ns, owner, labels, true, o.monitoring),
		valkeyService(valkeyName, ns, owner, map[string]interface{}{"statefulset.kubernetes.io/pod-name": valkeyName + "-0"}, false, false),
		valkeyService(valkeyName+"-read", ns, owner, labels, false, false),
		valkeyNetworkPolicy(ns, owner, labels, o.monitoring),
	}
	if o.monitoring {
		objects = append(objects, valkeyServiceMonitor(ns, owner))
	}
	return objects, nil
}

func valkeyService(name, ns, owner string, selector map[string]interface{}, headless, metrics bool) *unstructured.Unstructured {
	labels := map[string]interface{}{lblEngine: "valkey", "app.kubernetes.io/name": name}
	ports := []interface{}{map[string]interface{}{"name": "valkey", "port": int64(6379), "targetPort": "valkey"}}
	if metrics {
		ports = append(ports, map[string]interface{}{"name": "metrics", "port": int64(9121), "targetPort": "metrics"})
		labels["foundation.opensphere.io/metrics"] = "valkey"
	}
	spec := map[string]interface{}{"selector": selector, "ports": ports}
	if headless {
		spec["clusterIP"] = "None"
		spec["publishNotReadyAddresses"] = true
	}
	u := &unstructured.Unstructured{Object: map[string]interface{}{"apiVersion": "v1", "kind": "Service", "metadata": map[string]interface{}{"name": name, "namespace": ns, "labels": labels}, "spec": spec}}
	stampLabels(u, "data", owner)
	markEngine(u, "valkey")
	return u
}

func valkeyNetworkPolicy(ns, owner string, labels map[string]interface{}, monitoring bool) *unstructured.Unstructured {
	ports := []interface{}{map[string]interface{}{"protocol": "TCP", "port": int64(6379)}}
	if monitoring {
		ports = append(ports, map[string]interface{}{"protocol": "TCP", "port": int64(9121)})
	}
	allowed := map[string]interface{}{"matchExpressions": []interface{}{map[string]interface{}{"key": "kubernetes.io/metadata.name", "operator": "In", "values": []interface{}{ns, "opensphere-console", "monitoring"}}}}
	u := &unstructured.Unstructured{Object: map[string]interface{}{"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": map[string]interface{}{"name": valkeyName + "-internal", "namespace": ns}, "spec": map[string]interface{}{"podSelector": map[string]interface{}{"matchLabels": labels}, "policyTypes": []interface{}{"Ingress"}, "ingress": []interface{}{map[string]interface{}{"from": []interface{}{map[string]interface{}{"namespaceSelector": allowed}}, "ports": ports}}}}}
	stampLabels(u, "data", owner)
	markEngine(u, "valkey")
	return u
}

func valkeyServiceMonitor(ns, owner string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "monitoring.coreos.com/v1", "kind": "ServiceMonitor", "metadata": map[string]interface{}{"name": valkeyName, "namespace": ns},
		"spec": map[string]interface{}{"namespaceSelector": map[string]interface{}{"matchNames": []interface{}{ns}}, "selector": map[string]interface{}{"matchLabels": map[string]interface{}{"foundation.opensphere.io/metrics": "valkey"}}, "endpoints": []interface{}{map[string]interface{}{"port": "metrics", "path": "/metrics", "interval": "15s", "scrapeTimeout": "10s"}}},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, "valkey")
	return u
}

func buildRustFSBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	o, ns, owner := dataEngineParams(fm, cfg, "rustfs"), dataNS(cfg, fm), fm.GetName()
	if o.authSecret != rustfsDefaultAuthSecret {
		return nil, fmt.Errorf("rustfs authSecret must be %q", rustfsDefaultAuthSecret)
	}
	// A StatefulSet replica count alone is not a distributed RustFS topology.
	// Until endpoint-set/erasure-coding orchestration is implemented, expose the
	// truthful and recoverable single-node contract only.
	if o.replicas != 1 {
		return nil, fmt.Errorf("rustfs currently supports exactly one managed instance; distributed topology is not implemented")
	}
	c := map[string]interface{}{
		"name": "rustfs", "ports": []interface{}{map[string]interface{}{"name": "s3", "containerPort": int64(9000)}, map[string]interface{}{"name": "console", "containerPort": int64(9001)}},
		"env": []interface{}{
			map[string]interface{}{"name": "RUSTFS_VOLUMES", "value": "/data"}, map[string]interface{}{"name": "RUSTFS_ADDRESS", "value": "0.0.0.0:9000"}, map[string]interface{}{"name": "RUSTFS_CONSOLE_ADDRESS", "value": "0.0.0.0:9001"}, map[string]interface{}{"name": "RUSTFS_CONSOLE_ENABLE", "value": "true"},
			map[string]interface{}{"name": "RUSTFS_ACCESS_KEY", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "access_key"}}}, map[string]interface{}{"name": "RUSTFS_SECRET_KEY", "valueFrom": map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": o.authSecret, "key": "secret_key"}}},
		},
		"startupProbe":   map[string]interface{}{"tcpSocket": map[string]interface{}{"port": "s3"}, "periodSeconds": int64(5), "failureThreshold": int64(36)},
		"readinessProbe": map[string]interface{}{"tcpSocket": map[string]interface{}{"port": "s3"}, "periodSeconds": int64(8), "failureThreshold": int64(3)},
		"livenessProbe":  map[string]interface{}{"tcpSocket": map[string]interface{}{"port": "s3"}, "periodSeconds": int64(20), "failureThreshold": int64(3)},
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
		"apiVersion": "psmdb.percona.com/v1", "kind": "PerconaServerMongoDB", "metadata": map[string]interface{}{
			"name": psmdbName, "namespace": ns, "finalizers": []interface{}{"percona.com/delete-psmdb-pods-in-order"},
		},
		"spec": map[string]interface{}{
			"crVersion": "1.23.0", "image": o.image, "imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}}, "updateStrategy": "SmartUpdate", "upgradeOptions": map[string]interface{}{"apply": "Disabled"},
			"secrets": map[string]interface{}{
				"users": psmdbName + "-secrets", "ssl": psmdbName + "-ssl", "sslInternal": psmdbName + "-ssl-internal", "encryptionKey": psmdbName + "-mongodb-encryption-key",
			},
			"tls": map[string]interface{}{"mode": "preferTLS"}, "enableVolumeExpansion": true,
			"unsafeFlags": map[string]interface{}{"replsetSize": o.replicas < 3},
			"replsets": []interface{}{map[string]interface{}{
				"name": "rs0", "size": o.replicas, "resources": engineResources(o),
				"volumeSpec": map[string]interface{}{"persistentVolumeClaim": map[string]interface{}{"storageClassName": o.storageClass, "resources": map[string]interface{}{"requests": map[string]interface{}{"storage": o.storageSize}}}},
			}},
			"users": []interface{}{}, "sharding": map[string]interface{}{"enabled": false},
			// Operator 1.23.0 requires the supported component images even when
			// their optional features are disabled. Keep them exact-pinned so a
			// later enable operation cannot silently resolve a mutable upstream tag.
			"pmm":    map[string]interface{}{"enabled": false, "image": psmdbPMMImage},
			"backup": map[string]interface{}{"enabled": false, "image": psmdbBackupImage},
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
