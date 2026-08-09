package main

import (
	"context"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

func (r *claimReconciler) resolveSyncopeServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	statefulSet := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: syncopeName}, statefulSet); err != nil {
		if apierrors.IsNotFound(err) {
			return serviceBindingProjection{}, "SyncopeNotReady", nil
		}
		return serviceBindingProjection{}, "", err
	}
	desired, _, _ := unstructured.NestedInt64(statefulSet.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(statefulSet.Object, "status", "readyReplicas")
	if desired < 1 || ready < desired {
		return serviceBindingProjection{}, "SyncopeNotReady", nil
	}
	endpoint := syncopeURL(r.cfg.managedNS)
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: syncopeName + "." + r.cfg.managedNS + ".svc:8443", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "StatefulSet", "name": syncopeName, "namespace": r.cfg.managedNS}}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	if requestTypeOf(claim) != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	secretName = strings.TrimSpace(secretName)
	if !found || secretName == "" {
		return serviceBindingProjection{}, "SyncopeCredentialSecretRequired", nil
	}
	credential := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, credential); err != nil {
		if apierrors.IsNotFound(err) {
			return serviceBindingProjection{}, "SyncopeCredentialNotReady", nil
		}
		return serviceBindingProjection{}, "", err
	}
	if secretString(credential, "username") == "" || secretString(credential, "password") == "" {
		return serviceBindingProjection{}, "SyncopeCredentialInvalid", nil
	}
	projection.SecretRef = map[string]interface{}{"name": secretName, "namespace": claim.GetNamespace()}
	projection.ResourceRef = map[string]interface{}{"apiVersion": "syncope.apache.org/v1", "kind": "ServiceCredential", "name": secretName, "namespace": claim.GetNamespace()}
	projection.Capabilities = append(projection.Capabilities, "credential:consumer-managed")
	return projection, "", nil
}
