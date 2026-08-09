package main

import (
	"context"
	"encoding/base64"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const langfuseCredentialSuffix = "-langfuse-access"

func langfuseCredentialName(claim *unstructured.Unstructured) string {
	name := strings.ToLower(claim.GetName() + langfuseCredentialSuffix)
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func (r *claimReconciler) langfuseRuntime(ctx context.Context) (*unstructured.Unstructured, string, error) {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: langfuseName}, deployment); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "LangfuseNotReady", nil
		}
		return nil, "", err
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	if desired < 1 || ready < desired {
		return nil, "LangfuseNotReady", nil
	}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: aiRuntimeSecret}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "LangfuseBootstrapNotReady", nil
		}
		return nil, "", err
	}
	for _, key := range []string{"langfuse-init-org-id", "langfuse-init-project-id", "langfuse-init-project-public-key", "langfuse-init-project-secret-key"} {
		if secretString(secret, key) == "" {
			return nil, "LangfuseBootstrapInvalid", nil
		}
	}
	return secret, "", nil
}

func (r *claimReconciler) resolveLangfuseServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	endpoint := "http://" + langfuseName + "." + r.cfg.managedNS + ".svc:3000"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: langfuseName + "." + r.cfg.managedNS + ".svc:3000", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": langfuseName, "namespace": r.cfg.managedNS}}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	runtime, reason, err := r.langfuseRuntime(ctx)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	projectID := secretString(runtime, "langfuse-init-project-id")
	requestedProject := serviceClaimString(claim, projectID, "projectId")
	if requestedProject != projectID {
		// OSS self-hosting exposes one idempotent headless-initialized project.
		// Arbitrary project CRUD requires Langfuse's organization management API.
		return serviceBindingProjection{}, "LangfuseOrganizationAPIRequired", nil
	}
	projection.ResourceRef = map[string]interface{}{"apiVersion": "langfuse.opensphere.io/v1", "kind": "Project", "name": projectID, "namespace": secretString(runtime, "langfuse-init-org-id")}
	projection.Capabilities = append(projection.Capabilities, "project:"+projectID)
	if requestTypeOf(claim) == "Project" {
		return projection, "", nil
	}
	if requestTypeOf(claim) != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	name := langfuseCredentialName(claim)
	credential := object(coreSecretGVK, claim.GetNamespace(), name)
	credential.Object["type"] = "Opaque"
	credential.Object["data"] = map[string]interface{}{
		"public_key": base64.StdEncoding.EncodeToString([]byte(secretString(runtime, "langfuse-init-project-public-key"))),
		"secret_key": base64.StdEncoding.EncodeToString([]byte(secretString(runtime, "langfuse-init-project-secret-key"))),
		"base_url":   base64.StdEncoding.EncodeToString([]byte(endpoint)), "project_id": base64.StdEncoding.EncodeToString([]byte(projectID)),
	}
	credential.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-ai", lblModel: "ai", lblEngine: "langfuse", "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(credential.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, credential); err != nil {
		return serviceBindingProjection{}, "", err
	}
	projection.SecretRef = map[string]interface{}{"name": name, "namespace": claim.GetNamespace()}
	return projection, "", nil
}

func (r *claimReconciler) cleanupLangfuseServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) != "Access" {
		return true, nil
	}
	secret := object(coreSecretGVK, claim.GetNamespace(), langfuseCredentialName(claim))
	if err := r.direct.Delete(ctx, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return true, nil
		}
		return false, err
	}
	return false, nil
}
