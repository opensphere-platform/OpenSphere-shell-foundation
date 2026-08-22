package main

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const osStatefulSetName = "opensphere-search"
const openSearchAdminSecretName = osStatefulSetName + "-admin-credentials"
const openSearchSecurityConfigSecretName = osStatefulSetName + "-security-config"
const openSearchInitHelperImage = "ghcr.io/opensphere-platform/mirror/busybox:1.36@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"

var statefulSetGVK = schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"}
var openSearchClusterGVK = schema.GroupVersionKind{Group: "opensearch.opster.io", Version: "v1", Kind: "OpenSearchCluster"}
var openSearchRoleGVK = schema.GroupVersionKind{Group: "opensearch.opster.io", Version: "v1", Kind: "OpensearchRole"}
var openSearchUserGVK = schema.GroupVersionKind{Group: "opensearch.opster.io", Version: "v1", Kind: "OpensearchUser"}

func opensearchNS(cfg *config, fm *unstructured.Unstructured) string { return dataNS(cfg, fm) }
func opensearchSvcDNS(ns string) string                              { return osStatefulSetName + "." + ns + ".svc" }
func opensearchEndpoint(cfg *config, fm *unstructured.Unstructured) string {
	return "https://" + opensearchSvcDNS(opensearchNS(cfg, fm)) + ":9200"
}
func opensearchProbe(cfg *config, fm *unstructured.Unstructured) string {
	return opensearchSvcDNS(opensearchNS(cfg, fm)) + ":9200"
}

type opensearchOpts struct {
	storageClass string
	storageSize  string
	javaOpts     string
	image        string
	version      string
	replicas     int64
	resources    map[string]interface{}
	monitoring   bool
}

func opensearchParams(fm *unstructured.Unstructured, cfg *config) opensearchOpts {
	o := opensearchOpts{
		storageClass: readHostRequirements(fm, cfg).StorageClass,
		storageSize:  "5Gi",
		javaOpts:     "-Xms512m -Xmx512m",
		image:        cfg.opensearchImage,
		version:      "3.7.0",
		replicas:     1,
		resources:    resReq("500m", "1Gi", "2", "2Gi"),
		monitoring:   false,
	}
	p := nestedDataEngineParams(fm, "opensearch")
	if p == nil {
		p, _, _ = unstructured.NestedMap(fm.Object, "spec", "parameters", "opensearch")
	}
	if p == nil {
		return o
	}
	o.storageClass = pStr(p, "storageClass", o.storageClass)
	o.storageSize = pStr(p, "storageSize", o.storageSize)
	o.javaOpts = pStr(p, "javaOpts", o.javaOpts)
	o.javaOpts = pStr(p, "heap", o.javaOpts)
	o.version = pStr(p, "version", o.version)
	o.image = imageWithTag(o.image, o.version)
	o.image = pStr(p, "image", o.image)
	o.replicas = pInt(p, "replicas", o.replicas)
	o.resources = resourceProfile(pStr(p, "resourceProfile", "small"), p)
	o.monitoring = pBool(p, "monitoring", false)
	return o
}

func buildOpenSearchBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	ns := opensearchNS(cfg, fm)
	o := opensearchParams(fm, cfg)
	if o.replicas < 1 || o.replicas > 99 {
		return nil, fmt.Errorf("OpenSearch replicas must be in range 1..99")
	}
	cluster := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "opensearch.opster.io/v1",
		"kind":       "OpenSearchCluster",
		"metadata": map[string]interface{}{
			"name":      osStatefulSetName,
			"namespace": ns,
		},
		"spec": map[string]interface{}{
			// Do not allow the upstream operator to inject its mutable
			// docker.io/busybox:latest default into Foundation workloads.
			"initHelper": map[string]interface{}{
				"image": openSearchInitHelperImage, "imagePullPolicy": "IfNotPresent",
			},
			"general": map[string]interface{}{
				"serviceName":      osStatefulSetName,
				"version":          o.version,
				"image":            o.image,
				"imagePullPolicy":  "IfNotPresent",
				"imagePullSecrets": []interface{}{map[string]interface{}{"name": "opensphere-ghcr-pull"}},
				"setVMMaxMapCount": false,
				"podSecurityContext": map[string]interface{}{
					// The upstream volume-permission init helper explicitly runs as
					// UID 0. Keep the OpenSearch process identity at 1000 without a
					// contradictory Pod-wide runAsNonRoot constraint.
					"runAsUser": int64(1000), "runAsGroup": int64(1000), "fsGroup": int64(1000),
				},
				"securityContext": map[string]interface{}{
					"allowPrivilegeEscalation": false, "privileged": false,
					"capabilities": map[string]interface{}{"drop": []interface{}{"ALL"}},
				},
			},
			"security": map[string]interface{}{
				"tls": map[string]interface{}{
					"transport": map[string]interface{}{"generate": true, "perNode": true},
					"http":      map[string]interface{}{"generate": true},
				},
				"config": map[string]interface{}{
					"adminCredentialsSecret": map[string]interface{}{"name": openSearchAdminSecretName},
					"securityConfigSecret":   map[string]interface{}{"name": openSearchSecurityConfigSecretName},
				},
			},
			// The upstream OpenSearch operator requires replicas and version even
			// when Dashboards is disabled. Keep the disabled declaration complete
			// so API admission cannot reject the entire data-model reconcile.
			"dashboards": map[string]interface{}{
				"enable": false, "replicas": int64(1), "version": o.version,
			},
			"nodePools": []interface{}{
				map[string]interface{}{
					"component": "nodes", "replicas": o.replicas, "diskSize": o.storageSize, "jvm": o.javaOpts,
					"roles": []interface{}{"cluster_manager", "data", "ingest"}, "resources": o.resources,
					"persistence": map[string]interface{}{
						"pvc": map[string]interface{}{"storageClass": o.storageClass, "accessModes": []interface{}{"ReadWriteOnce"}},
					},
				},
			},
		},
	}}
	stampLabels(cluster, "data", fm.GetName())
	markEngine(cluster, "opensearch")

	np := openSearchNetworkPolicy(ns, fm.GetName())
	objects := []*unstructured.Unstructured{cluster, np}
	if o.monitoring {
		objects = append(objects, opensearchServiceMonitor(ns, fm.GetName()))
	}
	return objects, nil
}

func openSearchNetworkPolicy(ns, owner string) *unstructured.Unstructured {
	sameNamespace := map[string]interface{}{"matchLabels": map[string]interface{}{"kubernetes.io/metadata.name": ns}}
	apiNamespaces := map[string]interface{}{"matchExpressions": []interface{}{map[string]interface{}{"key": "kubernetes.io/metadata.name", "operator": "In", "values": []interface{}{"opensphere-console", "opensphere-system", "monitoring"}}}}
	managedConsumers := map[string]interface{}{"matchLabels": map[string]interface{}{"opensphere.io/managed-by": "foundation", "opensphere.io/purpose": "pfss-service"}}
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": map[string]interface{}{"name": osStatefulSetName + "-internal", "namespace": ns},
		"spec": map[string]interface{}{
			"podSelector": map[string]interface{}{"matchLabels": map[string]interface{}{"opster.io/opensearch-cluster": osStatefulSetName}},
			"policyTypes": []interface{}{"Ingress"},
			"ingress": []interface{}{
				map[string]interface{}{
					"from": []interface{}{map[string]interface{}{"namespaceSelector": sameNamespace}},
					"ports": []interface{}{
						map[string]interface{}{"protocol": "TCP", "port": int64(9200)},
						map[string]interface{}{"protocol": "TCP", "port": int64(9300)},
					},
				},
				map[string]interface{}{
					"from":  []interface{}{map[string]interface{}{"namespaceSelector": apiNamespaces}, map[string]interface{}{"namespaceSelector": managedConsumers}},
					"ports": []interface{}{map[string]interface{}{"protocol": "TCP", "port": int64(9200)}},
				},
			},
		},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, "opensearch")
	return u
}

func opensearchServiceMonitor(ns, owner string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "monitoring.coreos.com/v1",
		"kind":       "ServiceMonitor",
		"metadata": map[string]interface{}{
			"name":      osStatefulSetName,
			"namespace": ns,
		},
		"spec": map[string]interface{}{
			"namespaceSelector": map[string]interface{}{"matchNames": []interface{}{"opensphere-console"}},
			"selector": map[string]interface{}{
				"matchLabels": map[string]interface{}{"opensphere.io/dupa-plugin": "opensearch"},
			},
			"endpoints": []interface{}{
				map[string]interface{}{"port": "http", "path": "/metrics", "interval": "15s", "scrapeTimeout": "10s"},
			},
		},
	}}
	stampLabels(u, "data", owner)
	markEngine(u, "opensearch")
	return u
}

func markEngine(u *unstructured.Unstructured, engine string) {
	l := u.GetLabels()
	if l == nil {
		l = map[string]string{}
	}
	l[lblEngine] = engine
	u.SetLabels(l)
}

func (r *modelReconciler) getOpenSearchCluster(ctx context.Context, ns string) (*unstructured.Unstructured, error) {
	c := gvkObj(openSearchClusterGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: osStatefulSetName}, c)
	return c, err
}

func opensearchReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	c, err := r.getOpenSearchCluster(ctx, opensearchNS(r.cfg, fm))
	if err != nil {
		return false
	}
	return openSearchStatusReady(c, opensearchParams(fm, r.cfg).replicas)
}

func openSearchStatusReady(cluster *unstructured.Unstructured, expectedReplicas int64) bool {
	if cluster == nil {
		return false
	}
	phase, _, _ := unstructured.NestedString(cluster.Object, "status", "phase")
	health, _, _ := unstructured.NestedString(cluster.Object, "status", "health")
	ready, _, _ := unstructured.NestedInt64(cluster.Object, "status", "availableNodes")
	return phase == "RUNNING" && ready >= expectedReplicas && health != "red"
}

func opensearchGone(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	_, err := r.getOpenSearchCluster(ctx, opensearchNS(r.cfg, fm))
	return apierrors.IsNotFound(err)
}

func observeOpenSearch(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) []interface{} {
	o := opensearchParams(fm, r.cfg)
	mk := func(id, unit, val string, healthy bool, src string) map[string]interface{} {
		return map[string]interface{}{"id": id, "unit": unit, "value": val, "healthy": healthy, "source": src}
	}
	if !engineEnabled(fm, "opensearch") {
		return []interface{}{
			mk("opensearch_up", "bool", "n/a", false, "spec.parameters.engines.opensearch"),
			mk("opensearch_endpoint", "", "disabled", false, "spec.parameters.engines.opensearch"),
		}
	}
	cluster, err := r.getOpenSearchCluster(ctx, opensearchNS(r.cfg, fm))
	var ready int64
	health := "unknown"
	if err == nil {
		ready, _, _ = unstructured.NestedInt64(cluster.Object, "status", "availableNodes")
		health, _, _ = unstructured.NestedString(cluster.Object, "status", "health")
	}
	up := "0"
	readyHealthy := err == nil && openSearchStatusReady(cluster, o.replicas)
	reportedHealthy := health == "green" || health == "yellow"
	if readyHealthy {
		up = "1"
	}
	return []interface{}{
		mk("opensearch_up", "bool", up, readyHealthy, "OpenSearchCluster.status.phase+availableNodes"),
		mk("opensearch_namespace", "", opensearchNS(r.cfg, fm), true, "spec.parameters.namespace"),
		mk("opensearch_ready_replicas", "count", fmt.Sprintf("%d/%d", ready, o.replicas), readyHealthy, "OpenSearchCluster.status.availableNodes"),
		mk("opensearch_health", "", health, reportedHealthy, "OpenSearchCluster.status.health"),
		mk("opensearch_endpoint", "", opensearchEndpoint(r.cfg, fm), true, "Service"),
		mk("opensearch_storage", "", o.storageSize+" @ "+o.storageClass, true, "StatefulSet.volumeClaimTemplates"),
		mk("opensearch_heap", "", o.javaOpts, true, "OPENSEARCH_JAVA_OPTS"),
	}
}
