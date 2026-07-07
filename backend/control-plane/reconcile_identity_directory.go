// reconcile_identity_directory.go — typed IdentityDirectoryClaim reconcile.
// 사용자는 directory 사용 의도만 선언한다. endpointRef/secretRef/policyRef Binding은 Foundation control-plane이 발급한다.
package main

import (
	"context"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

const (
	identityModel           = "identity"
	identityDirectoryName   = "foundation-identity-samba"
	identityDirectoryPort   = int64(389)
	identityDirectoryProto  = "ldap"
	identityDirectorySecret = "foundation-identity-samba-creds"
)

type identityDirectoryReconciler struct {
	cached client.Client
	direct client.Client
	cfg    *config
}

func (r *identityDirectoryReconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	log := ctrl.LoggerFrom(ctx)
	claim := gvkObj(idcGVK)
	if err := r.cached.Get(ctx, req.NamespacedName, claim); err != nil {
		return reconcile.Result{}, client.IgnoreNotFound(err)
	}
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}

	if claim.GetDeletionTimestamp() != nil {
		return r.release(ctx, claim)
	}
	if !hasFinalizer(claim, finalizer) {
		if err := updateMetaRetry(ctx, r.direct, idcGVK, nn, func(o *unstructured.Unstructured) { addFinalizer(o, finalizer) }); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{Requeue: true}, nil
	}

	fm := gvkObj(fmGVK)
	fmErr := r.cached.Get(ctx, types.NamespacedName{Name: identityModel}, fm)
	phase, _, _ := unstructured.NestedString(fm.Object, "status", "phase")
	if fmErr != nil || phase != "Installed" || !engineEnabled(fm, "samba") {
		if err := updateStatusRetry(ctx, r.direct, idcGVK, nn, func(o *unstructured.Unstructured) {
			setNested(o, "Pending", "status", "phase")
			setNested(o, "Samba-AD engine is not installed or not ready", "status", "reason")
		}); err != nil {
			return reconcile.Result{}, err
		}
		return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
	}

	bindingName := claim.GetName() + "-binding"
	bnn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: bindingName}
	existing := gvkObj(idbGVK)
	if gerr := r.direct.Get(ctx, bnn, existing); gerr == nil && existing.GetDeletionTimestamp() != nil {
		if uerr := updateMetaRetry(ctx, r.direct, idbGVK, bnn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil && !apierrors.IsNotFound(uerr) {
			return reconcile.Result{}, uerr
		}
		return reconcile.Result{RequeueAfter: 2 * time.Second}, nil
	}

	if err := applyObj(ctx, r.direct, r.buildBinding(claim, bindingName)); err != nil {
		return reconcile.Result{}, err
	}

	probe := identityDirectoryDNS(r.cfg.managedNS) + ":389"
	rtt, connected := probeTCP(ctx, probe)
	if err := updateStatusRetry(ctx, r.direct, idbGVK, bnn, func(o *unstructured.Unstructured) {
		if connected {
			setNested(o, "Connected", "status", "phase")
			setNested(o, int64(rtt), "status", "connection", "rttMs")
		} else {
			setNested(o, "Degraded", "status", "phase")
			unstructured.RemoveNestedField(o.Object, "status", "connection", "rttMs")
		}
		setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "connection", "lastCheck")
	}); err != nil {
		return reconcile.Result{}, err
	}
	if err := updateStatusRetry(ctx, r.direct, idcGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, "Bound", "status", "phase")
		_ = unstructured.SetNestedMap(o.Object, map[string]interface{}{"name": bindingName, "namespace": claim.GetNamespace()}, "status", "bindingRef")
	}); err != nil {
		return reconcile.Result{}, err
	}
	log.Info("identity directory claim bound", "claim", claim.GetName(), "binding", bindingName, "connected", connected)
	return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
}

func (r *identityDirectoryReconciler) release(ctx context.Context, claim *unstructured.Unstructured) (reconcile.Result, error) {
	nn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName()}
	bnn := types.NamespacedName{Namespace: claim.GetNamespace(), Name: claim.GetName() + "-binding"}
	b := gvkObj(idbGVK)
	err := r.direct.Get(ctx, bnn, b)
	if err == nil {
		if b.GetDeletionTimestamp() == nil {
			_ = updateStatusRetry(ctx, r.direct, idbGVK, bnn, func(o *unstructured.Unstructured) { setNested(o, "Released", "status", "phase") })
			if derr := r.direct.Delete(ctx, b); derr != nil && !apierrors.IsNotFound(derr) {
				return reconcile.Result{}, derr
			}
			return reconcile.Result{Requeue: true}, nil
		}
		if uerr := updateMetaRetry(ctx, r.direct, idbGVK, bnn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil && !apierrors.IsNotFound(uerr) {
			return reconcile.Result{}, uerr
		}
		return reconcile.Result{Requeue: true}, nil
	}
	if !apierrors.IsNotFound(err) {
		return reconcile.Result{}, err
	}
	if uerr := updateMetaRetry(ctx, r.direct, idcGVK, nn, func(o *unstructured.Unstructured) { removeFinalizer(o, finalizer) }); uerr != nil {
		return reconcile.Result{}, client.IgnoreNotFound(uerr)
	}
	return reconcile.Result{}, nil
}

func (r *identityDirectoryReconciler) buildBinding(claim *unstructured.Unstructured, name string) *unstructured.Unstructured {
	b := gvkObj(idbGVK)
	b.SetName(name)
	b.SetNamespace(claim.GetNamespace())
	b.SetFinalizers([]string{finalizer})
	stampLabels(b, identityModel, claim.GetName())
	_ = unstructured.SetNestedSlice(b.Object, []interface{}{
		map[string]interface{}{
			"apiVersion":         grp + "/" + ver,
			"kind":               "IdentityDirectoryClaim",
			"name":               claim.GetName(),
			"uid":                string(claim.GetUID()),
			"controller":         true,
			"blockOwnerDeletion": true,
		},
	}, "metadata", "ownerReferences")
	_ = unstructured.SetNestedMap(b.Object, map[string]interface{}{"name": claim.GetName(), "namespace": claim.GetNamespace()}, "spec", "claimRef")
	_ = unstructured.SetNestedMap(b.Object, map[string]interface{}{
		"name":      identityDirectoryName,
		"namespace": r.cfg.managedNS,
		"service":   identityDirectoryName,
		"port":      identityDirectoryPort,
		"protocol":  identityDirectoryProto,
		"url":       identityDirectoryURL(r.cfg.managedNS),
	}, "spec", "endpointRef")
	_ = unstructured.SetNestedMap(b.Object, map[string]interface{}{"name": identityDirectorySecret, "namespace": r.cfg.managedNS}, "spec", "secretRef")
	_ = unstructured.SetNestedMap(b.Object, map[string]interface{}{"name": identityDirectoryName, "namespace": r.cfg.managedNS}, "spec", "policyRef")
	return b
}

func identityDirectoryDNS(ns string) string {
	return identityDirectoryName + "." + ns + ".svc"
}

func identityDirectoryURL(ns string) string {
	return "ldap://" + identityDirectoryDNS(ns) + ":389"
}
