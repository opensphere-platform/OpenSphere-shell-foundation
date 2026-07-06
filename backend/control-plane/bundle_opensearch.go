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

var statefulSetGVK = schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"}

func opensearchNS(cfg *config, fm *unstructured.Unstructured) string { return dataNS(cfg, fm) }
func opensearchSvcDNS(ns string) string                              { return osStatefulSetName + "." + ns + ".svc" }
func opensearchEndpoint(cfg *config, fm *unstructured.Unstructured) string {
	return "http://" + opensearchSvcDNS(opensearchNS(cfg, fm)) + ":9200"
}
func opensearchProbe(cfg *config, fm *unstructured.Unstructured) string {
	return opensearchSvcDNS(opensearchNS(cfg, fm)) + ":9200"
}

type opensearchOpts struct {
	storageClass string
	storageSize  string
	javaOpts     string
	image        string
}

func opensearchParams(fm *unstructured.Unstructured, cfg *config) opensearchOpts {
	o := opensearchOpts{
		storageClass: readHostRequirements(fm, cfg).StorageClass,
		storageSize:  "5Gi",
		javaOpts:     "-Xms512m -Xmx512m",
		image:        cfg.opensearchImage,
	}
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters", "opensearch")
	if p == nil {
		return o
	}
	o.storageClass = pStr(p, "storageClass", o.storageClass)
	o.storageSize = pStr(p, "storageSize", o.storageSize)
	o.javaOpts = pStr(p, "javaOpts", o.javaOpts)
	o.image = pStr(p, "image", o.image)
	return o
}

func buildOpenSearchBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	ns := opensearchNS(cfg, fm)
	o := opensearchParams(fm, cfg)
	labels := map[string]interface{}{"app": osStatefulSetName}

	sts := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "StatefulSet",
		"metadata": map[string]interface{}{
			"name":      osStatefulSetName,
			"namespace": ns,
		},
		"spec": map[string]interface{}{
			"serviceName": osStatefulSetName,
			"replicas":    int64(1),
			"selector": map[string]interface{}{
				"matchLabels": labels,
			},
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{"labels": labels},
				"spec": map[string]interface{}{
					"initContainers": []interface{}{
						map[string]interface{}{
							"name":    "sysctl",
							"image":   "ghcr.io/opensphere-platform/mirror/busybox:1.36",
							"command": []interface{}{"sh", "-c", "sysctl -w vm.max_map_count=262144 || true"},
							"securityContext": map[string]interface{}{
								"privileged": true,
							},
						},
					},
					"containers": []interface{}{
						map[string]interface{}{
							"name":  "opensearch",
							"image": o.image,
							"env": []interface{}{
								map[string]interface{}{"name": "cluster.name", "value": osStatefulSetName},
								map[string]interface{}{"name": "node.name", "value": osStatefulSetName + "-0"},
								map[string]interface{}{"name": "discovery.type", "value": "single-node"},
								map[string]interface{}{"name": "DISABLE_SECURITY_PLUGIN", "value": "true"},
								map[string]interface{}{"name": "DISABLE_INSTALL_DEMO_CONFIG", "value": "true"},
								map[string]interface{}{"name": "bootstrap.memory_lock", "value": "false"},
								map[string]interface{}{"name": "OPENSEARCH_JAVA_OPTS", "value": o.javaOpts},
							},
							"ports": []interface{}{
								map[string]interface{}{"name": "http", "containerPort": int64(9200)},
								map[string]interface{}{"name": "transport", "containerPort": int64(9300)},
							},
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{"cpu": "500m", "memory": "1Gi"},
								"limits":   map[string]interface{}{"memory": "2Gi"},
							},
							"readinessProbe": map[string]interface{}{
								"httpGet":             map[string]interface{}{"path": "/_cluster/health", "port": int64(9200)},
								"initialDelaySeconds": int64(25),
								"periodSeconds":       int64(10),
								"timeoutSeconds":      int64(5),
								"failureThreshold":    int64(18),
							},
							"volumeMounts": []interface{}{
								map[string]interface{}{"name": "data", "mountPath": "/usr/share/opensearch/data"},
							},
						},
					},
				},
			},
			"volumeClaimTemplates": []interface{}{
				map[string]interface{}{
					"metadata": map[string]interface{}{"name": "data"},
					"spec": map[string]interface{}{
						"accessModes":      []interface{}{"ReadWriteOnce"},
						"storageClassName": o.storageClass,
						"resources": map[string]interface{}{
							"requests": map[string]interface{}{"storage": o.storageSize},
						},
					},
				},
			},
		},
	}}
	stampLabels(sts, "data", fm.GetName())
	markEngine(sts, "opensearch")

	svc := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Service",
		"metadata": map[string]interface{}{
			"name":      osStatefulSetName,
			"namespace": ns,
		},
		"spec": map[string]interface{}{
			"selector": labels,
			"ports": []interface{}{
				map[string]interface{}{"name": "http", "port": int64(9200), "targetPort": int64(9200)},
				map[string]interface{}{"name": "transport", "port": int64(9300), "targetPort": int64(9300)},
			},
		},
	}}
	stampLabels(svc, "data", fm.GetName())
	markEngine(svc, "opensearch")

	return []*unstructured.Unstructured{sts, svc}, nil
}

func markEngine(u *unstructured.Unstructured, engine string) {
	l := u.GetLabels()
	if l == nil {
		l = map[string]string{}
	}
	l[lblEngine] = engine
	u.SetLabels(l)
}

func (r *modelReconciler) getOpenSearchStatefulSet(ctx context.Context, ns string) (*unstructured.Unstructured, error) {
	c := gvkObj(statefulSetGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: osStatefulSetName}, c)
	return c, err
}

func opensearchReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	c, err := r.getOpenSearchStatefulSet(ctx, opensearchNS(r.cfg, fm))
	if err != nil {
		return false
	}
	replicas, _, _ := unstructured.NestedInt64(c.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(c.Object, "status", "readyReplicas")
	if replicas <= 0 {
		replicas = 1
	}
	return ready >= replicas
}

func opensearchGone(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	_, err := r.getOpenSearchStatefulSet(ctx, opensearchNS(r.cfg, fm))
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
	sts, err := r.getOpenSearchStatefulSet(ctx, opensearchNS(r.cfg, fm))
	var replicas, ready int64
	if err == nil {
		replicas, _, _ = unstructured.NestedInt64(sts.Object, "spec", "replicas")
		ready, _, _ = unstructured.NestedInt64(sts.Object, "status", "readyReplicas")
	}
	up := "0"
	healthy := false
	if replicas <= 0 {
		replicas = 1
	}
	if ready >= replicas {
		up = "1"
		healthy = true
	}
	return []interface{}{
		mk("opensearch_up", "bool", up, healthy, "StatefulSet.status.readyReplicas"),
		mk("opensearch_namespace", "", opensearchNS(r.cfg, fm), true, "spec.parameters.namespace"),
		mk("opensearch_ready_replicas", "count", fmt.Sprintf("%d/%d", ready, replicas), healthy, "StatefulSet.status.readyReplicas"),
		mk("opensearch_endpoint", "", opensearchEndpoint(r.cfg, fm), true, "Service"),
		mk("opensearch_storage", "", o.storageSize+" @ "+o.storageClass, true, "StatefulSet.volumeClaimTemplates"),
		mk("opensearch_heap", "", o.javaOpts, true, "OPENSEARCH_JAVA_OPTS"),
	}
}
