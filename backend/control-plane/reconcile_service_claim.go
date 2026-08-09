package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

type serviceBindingProjection struct {
	Module       string
	Endpoint     string
	Probe        string
	Capabilities []string
	Dependencies []serviceDependencyBinding
	SecretRef    map[string]interface{}
	ResourceRef  map[string]interface{}
}

type serviceDependencyBinding struct {
	Module      string
	RequestType string
	Required    bool
	BindingRef  map[string]interface{}
	ResourceRef map[string]interface{}
	Endpoint    string
}

func (p serviceBindingProjection) apply(binding *unstructured.Unstructured) {
	setNested(binding, p.Module, "spec", "module")
	endpoints := []interface{}{map[string]interface{}{
		"name": "primary", "uri": p.Endpoint, "protocol": endpointProtocol(p.Endpoint), "readOnly": false,
	}}
	_ = unstructured.SetNestedSlice(binding.Object, endpoints, "spec", "endpoints")
	capabilities := make([]interface{}, 0, len(p.Capabilities))
	for _, capability := range p.Capabilities {
		capabilities = append(capabilities, capability)
	}
	_ = unstructured.SetNestedSlice(binding.Object, capabilities, "spec", "capabilities")
	dependencies := make([]interface{}, 0, len(p.Dependencies))
	for _, dependency := range p.Dependencies {
		item := map[string]interface{}{
			"module": dependency.Module, "requestType": dependency.RequestType, "required": dependency.Required,
		}
		if dependency.BindingRef != nil {
			item["bindingRef"] = dependency.BindingRef
		}
		if dependency.ResourceRef != nil {
			item["resourceRef"] = dependency.ResourceRef
		}
		if dependency.Endpoint != "" {
			item["endpoint"] = dependency.Endpoint
		}
		dependencies = append(dependencies, item)
	}
	_ = unstructured.SetNestedSlice(binding.Object, dependencies, "spec", "dependencies")
	if p.SecretRef != nil {
		_ = unstructured.SetNestedMap(binding.Object, p.SecretRef, "spec", "secretRef")
	}
	if p.ResourceRef != nil {
		_ = unstructured.SetNestedMap(binding.Object, p.ResourceRef, "spec", "resourceRef")
	}
}

func endpointProtocol(endpoint string) string {
	if i := strings.Index(endpoint, "://"); i > 0 {
		return endpoint[:i]
	}
	return "tcp"
}

func requestTypeOf(claim *unstructured.Unstructured) string {
	requestType, _, _ := unstructured.NestedString(claim.Object, "spec", "request", "type")
	return requestType
}

func targetRefOf(claim *unstructured.Unstructured) map[string]interface{} {
	ref, _, _ := unstructured.NestedMap(claim.Object, "spec", "request", "targetRef")
	return ref
}

func (r *claimReconciler) resolveServiceModuleBinding(
	ctx context.Context,
	claim, model *unstructured.Unstructured,
	contract serviceModuleContract,
) (serviceBindingProjection, string, error) {
	requestType := requestTypeOf(claim)
	if requestType == "" {
		return serviceBindingProjection{}, "RequestTypeRequired", nil
	}
	if !contract.supports(requestType) {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	if !contract.requestReady(requestType) {
		return serviceBindingProjection{}, "RequestDriverNotReady", nil
	}
	if !engineEnabled(model, contract.EngineID) {
		return serviceBindingProjection{}, "ModuleDisabled", nil
	}
	if contract.ID == "postgres" {
		return r.resolvePostgresServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "percona-psmdb" {
		return r.resolvePSMDBServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "valkey" {
		return r.resolveValkeyServiceBinding(ctx, claim, model, contract)
	}
	if contract.ID == "opensearch" {
		return r.resolveOpenSearchServiceBinding(ctx, claim, model, contract)
	}
	if contract.ID == "rustfs" {
		return r.resolveRustFSServiceBinding(ctx, claim, model, contract)
	}
	if contract.ID == "keycloak" {
		return r.resolveKeycloakServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "directory" {
		return r.resolveDirectoryServiceBinding(ctx, claim, model, contract)
	}
	if contract.ID == "argocd" || contract.ID == "crossplane" {
		return r.resolveDeliveryServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "ptm" {
		return r.resolveBackupServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "stalwart" {
		return r.resolveStalwartServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "novu" {
		return r.resolveNovuServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "mattermost" {
		return r.resolveMattermostServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "grafana-tempo" || contract.ID == "grafana-loki" {
		return r.resolveObservabilityTenantBinding(ctx, claim, contract)
	}
	if contract.ID == "grafana-operator" {
		return r.resolveGrafanaServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "litellm" {
		return r.resolveLiteLLMServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "langfuse" {
		return r.resolveLangfuseServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "opa" {
		return r.resolveOPAServiceBinding(ctx, claim, contract)
	}
	if contract.ID == "apache-syncope" {
		return r.resolveSyncopeServiceBinding(ctx, claim, contract)
	}
	if contract.Endpoint == nil || contract.Probe == nil {
		return serviceBindingProjection{}, "DriverNotReady", nil
	}
	projection := serviceBindingProjection{
		Module:       contract.ID,
		Endpoint:     contract.Endpoint(r.cfg, model),
		Probe:        contract.Probe(r.cfg, model),
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef: map[string]interface{}{
			"apiVersion": grp + "/" + ver,
			"kind":       "FoundationModel",
			"name":       model.GetName(),
		},
	}
	if secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name"); found && secretName != "" {
		secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
			return serviceBindingProjection{}, "CredentialSecretNotReady", nil
		}
		projection.SecretRef = map[string]interface{}{"name": secretName, "namespace": claim.GetNamespace()}
	}
	return projection, "", nil
}

func (r *claimReconciler) resolvePostgresServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.postgresServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	child, err := renderPostgresServiceClaim(claim)
	if err != nil {
		return serviceBindingProjection{}, "InvalidRequest", nil
	}
	if err := applyObj(ctx, r.direct, child); err != nil {
		return serviceBindingProjection{}, "", err
	}
	targetName, targetNamespace := child.GetName(), child.GetNamespace()
	target := gvkObj(postgresClaimGVK)
	if err := r.cached.Get(ctx, types.NamespacedName{Namespace: targetNamespace, Name: targetName}, target); err != nil {
		return serviceBindingProjection{}, "PostgresClaimNotReady", nil
	}
	phase, _, _ := unstructured.NestedString(target.Object, "status", "phase")
	if phase != "Ready" {
		return serviceBindingProjection{}, "PostgresClaimNotReady", nil
	}
	bindingName, _, _ := unstructured.NestedString(target.Object, "status", "bindingRef", "name")
	bindingNamespace, _, _ := unstructured.NestedString(target.Object, "status", "bindingRef", "namespace")
	if bindingName == "" {
		return serviceBindingProjection{}, "PostgresBindingNotReady", nil
	}
	if bindingNamespace == "" {
		bindingNamespace = targetNamespace
	}
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: bindingNamespace, Name: bindingName}, secret); err != nil {
		return serviceBindingProjection{}, "PostgresBindingNotReady", nil
	}
	endpoint := secretString(secret, "uri")
	if endpoint == "" {
		host, port := secretString(secret, "host"), secretString(secret, "port")
		if host != "" && port != "" {
			endpoint = "postgresql://" + host + ":" + port
		}
	}
	if endpoint == "" {
		return serviceBindingProjection{}, "PostgresEndpointNotReady", nil
	}
	host, port := secretString(secret, "host"), secretString(secret, "port")
	if host == "" || port == "" {
		return serviceBindingProjection{}, "PostgresEndpointNotReady", nil
	}
	providerRef, _, _ := unstructured.NestedMap(target.Object, "status", "providerRef")
	return serviceBindingProjection{
		Module:       contract.ID,
		Endpoint:     endpoint,
		Probe:        host + ":" + port,
		Capabilities: append([]string(nil), contract.Capabilities...),
		SecretRef:    map[string]interface{}{"name": bindingName, "namespace": bindingNamespace},
		ResourceRef:  providerRef,
	}, "", nil
}

func secretString(secret *unstructured.Unstructured, key string) string {
	if value, found, _ := unstructured.NestedString(secret.Object, "stringData", key); found {
		return value
	}
	encoded, found, _ := unstructured.NestedString(secret.Object, "data", key)
	if !found || encoded == "" {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	return string(decoded)
}

func (r *claimReconciler) pendingServiceClaim(ctx context.Context, nn types.NamespacedName, reason string) (reconcile.Result, error) {
	err := updateStatusRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, "Pending", "status", "phase")
		setNested(o, reason, "status", "reason")
		setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "observedAt")
	})
	return reconcile.Result{RequeueAfter: 10 * time.Second}, err
}

func (r *claimReconciler) rejectServiceClaim(ctx context.Context, nn types.NamespacedName, reason, message string) (reconcile.Result, error) {
	err := updateStatusRetry(ctx, r.direct, fcGVK, nn, func(o *unstructured.Unstructured) {
		setNested(o, "Failed", "status", "phase")
		setNested(o, reason, "status", "reason")
		setNested(o, message, "status", "message")
		setNested(o, time.Now().UTC().Format(time.RFC3339), "status", "observedAt")
	})
	if err != nil {
		return reconcile.Result{}, fmt.Errorf("service claim rejection status: %w", err)
	}
	return reconcile.Result{}, nil
}
