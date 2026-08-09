package main

import (
	"context"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

const (
	backupOperatorNamespace = "opensphere-backup"
	backupOperatorName      = "opensphere-backup"
	veleroDeploymentName    = "velero"
)

// Backup and Velero have independent cluster-scoped release lifecycles.
// Foundation owns the northbound PFS contract and observes those operators;
// it never duplicates their Deployments or CRDs inside the model bundle.
func buildBackupBundle(_ *config, _ *unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
	return []*unstructured.Unstructured{}, nil
}

func (r *modelReconciler) backupOperatorsReady(ctx context.Context) bool {
	return r.crdEstablished(ctx, "backuppolicies.backup.opensphere.io") &&
		r.crdEstablished(ctx, "backupruns.backup.opensphere.io") &&
		r.crdEstablished(ctx, "restoreruns.backup.opensphere.io") &&
		r.crdEstablished(ctx, "backups.velero.io") &&
		r.crdEstablished(ctx, "restores.velero.io") &&
		r.crdEstablished(ctx, "backupstoragelocations.velero.io") &&
		r.externalWorkloadReady(ctx, depGVK, backupOperatorNamespace, backupOperatorName) &&
		r.externalWorkloadReady(ctx, depGVK, "velero", veleroDeploymentName)
}

func backupReady(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured) bool {
	return !engineEnabled(fm, "ptm") || r.backupOperatorsReady(ctx)
}

func observeBackup(ctx context.Context, r *modelReconciler, fm *unstructured.Unstructured, _ bool) ([]interface{}, map[string]interface{}) {
	enabled := engineEnabled(fm, "ptm")
	ready := enabled && r.backupOperatorsReady(ctx)
	value := "disabled"
	if enabled {
		value = "0"
	}
	if ready {
		value = "1"
	}
	return []interface{}{
		map[string]interface{}{"id": "ptm_operator_up", "unit": "bool", "value": value, "healthy": ready, "source": "OpenSphere Backup + Velero CRD and workload readiness"},
		map[string]interface{}{"id": "ptm_endpoint", "unit": "", "value": "https://kubernetes.default.svc:443", "healthy": ready, "source": "declarative Kubernetes API"},
	}, nil
}

func backupGone(context.Context, *modelReconciler, *unstructured.Unstructured) bool { return true }

func backupEndpoint(_ *config) string { return "https://kubernetes.default.svc:443" }
func backupProbe(_ *config) string    { return "kubernetes.default.svc:443" }
