package main

import (
	"context"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

const syncopeName = "foundation-identity-syncope"

type syncopeEngineOpts struct {
	version, profile, cpuRequest, memoryRequest, cpuLimit, memoryLimit string
	replicas                                                           int64
	monitoring                                                         bool
}

func syncopeExplicitlyEnabled(fm *unstructured.Unstructured) bool {
	v, found, _ := unstructured.NestedString(fm.Object, "spec", "parameters", "engines", "syncope")
	return found && v == "enabled"
}

func syncopeParams(fm *unstructured.Unstructured) syncopeEngineOpts {
	o := syncopeEngineOpts{version: "4.0.7", profile: "production", replicas: 2, cpuRequest: "250m", memoryRequest: "768Mi", cpuLimit: "1", memoryLimit: "2Gi", monitoring: true}
	p, _, _ := unstructured.NestedMap(fm.Object, "spec", "parameters", "identityEngines", "syncope")
	if p == nil {
		return o
	}
	o.version = pStr(p, "version", o.version)
	if o.version != "4.0.7" {
		o.version = "4.0.7"
	}
	o.profile = pStr(p, "profile", o.profile)
	if o.profile != "production" {
		o.profile = "production"
	}
	o.cpuRequest = pStr(p, "cpuRequest", o.cpuRequest)
	o.memoryRequest = pStr(p, "memoryRequest", o.memoryRequest)
	o.cpuLimit = pStr(p, "cpuLimit", o.cpuLimit)
	o.memoryLimit = pStr(p, "memoryLimit", o.memoryLimit)
	o.replicas = pInt(p, "replicas", o.replicas)
	if o.replicas < 2 {
		o.replicas = 2
	}
	if o.replicas > 5 {
		o.replicas = 5
	}
	o.monitoring = pBool(p, "monitoring", true)
	return o
}

func buildSyncopeBundle(cfg *config, fm *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	doc := strings.ReplaceAll(identitySyncopeBundleYAML, "__SYNCOPE_MONITOR_IMAGE__", cfg.syncopeMonitorImage)
	objs, err := buildBundle(doc, cfg.managedNS, imageWithTag(cfg.syncopeImage, "4.0.7"), "identity", fm.GetName())
	if err != nil {
		return nil, err
	}
	o := syncopeParams(fm)
	out := make([]*unstructured.Unstructured, 0, len(objs))
	for _, obj := range objs {
		labels := obj.GetLabels()
		if labels == nil {
			labels = map[string]string{}
		}
		labels[lblEngine] = "syncope"
		obj.SetLabels(labels)
		if !o.monitoring && (obj.GetKind() == "ServiceMonitor" || obj.GetKind() == "PrometheusRule") {
			continue
		}
		if obj.GetKind() == "StatefulSet" && obj.GetName() == syncopeName {
			_ = unstructured.SetNestedField(obj.Object, o.replicas, "spec", "replicas")
			containers, found, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
			if found && len(containers) >= 2 {
				core, _ := containers[0].(map[string]interface{})
				core["image"] = imageWithTag(cfg.syncopeImage, o.version)
				core["resources"] = map[string]interface{}{
					"requests": map[string]interface{}{"cpu": o.cpuRequest, "memory": o.memoryRequest},
					"limits":   map[string]interface{}{"cpu": o.cpuLimit, "memory": o.memoryLimit},
				}
				monitor, _ := containers[1].(map[string]interface{})
				monitor["image"] = cfg.syncopeMonitorImage
				containers[0], containers[1] = core, monitor
				_ = unstructured.SetNestedSlice(obj.Object, containers, "spec", "template", "spec", "containers")
			}
			annotations := obj.GetAnnotations()
			if annotations == nil {
				annotations = map[string]string{}
			}
			annotations["foundation.opensphere.io/profile"] = o.profile
			annotations["foundation.opensphere.io/monitoring"] = boolStr(o.monitoring)
			annotations["foundation.opensphere.io/database"] = "CloudNativePG/foundation-data-pg/syncope"
			annotations["foundation.opensphere.io/tls-mode"] = "TLS"
			obj.SetAnnotations(annotations)
		}
		out = append(out, obj)
	}
	return out, nil
}

func (r *modelReconciler) syncopeReady(ctx context.Context, fm *unstructured.Unstructured) bool {
	sts := gvkObj(statefulSetGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: syncopeName}, sts); err != nil {
		return false
	}
	ready, _, _ := unstructured.NestedInt64(sts.Object, "status", "readyReplicas")
	observed, _, _ := unstructured.NestedInt64(sts.Object, "status", "observedGeneration")
	desired := syncopeParams(fm).replicas
	return ready >= desired && observed >= sts.GetGeneration()
}

func (r *modelReconciler) syncopeDatabaseReady(ctx context.Context) bool {
	cluster := gvkObj(cnpgClusterGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: "foundation-data-pg"}, cluster); err != nil {
		return false
	}
	conditions, _, _ := unstructured.NestedSlice(cluster.Object, "status", "conditions")
	for _, raw := range conditions {
		condition, _ := raw.(map[string]interface{})
		if condition["type"] == "Ready" {
			return condition["status"] == "True"
		}
	}
	return false
}

func syncopeURL(ns string) string {
	return "https://" + syncopeName + "." + ns + ".svc:8443/syncope/rest"
}

func syncopeObserved(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) map[string]interface{} {
	if !syncopeExplicitlyEnabled(fm) {
		return map[string]interface{}{"id": "syncope_up", "unit": "bool", "value": "n/a", "healthy": false, "source": "StatefulSet.status.readyReplicas", "note": "engines.syncope=enabled 명시 전 비활성(opt-in)"}
	}
	ready := r.syncopeReady(ctx, fm)
	value := "0"
	if ready {
		value = "1"
	}
	return map[string]interface{}{"id": "syncope_up", "unit": "bool", "value": value, "healthy": ready, "source": "StatefulSet.status.readyReplicas"}
}

func syncopeProductionReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	o := syncopeParams(fm)
	return syncopeExplicitlyEnabled(fm) && o.profile == "production" && o.replicas >= 2 && o.monitoring && r.syncopeReady(ctx, fm) && r.syncopeDatabaseReady(ctx)
}

func syncopeStatusNote(fm *unstructured.Unstructured) string {
	if !syncopeExplicitlyEnabled(fm) {
		return "Apache Syncope is explicit opt-in"
	}
	o := syncopeParams(fm)
	return fmt.Sprintf("Apache Syncope %s %s profile, %d Core replicas", o.version, o.profile, o.replicas)
}
