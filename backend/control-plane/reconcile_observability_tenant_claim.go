package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
)

var observabilityTenantPattern = regexp.MustCompile(`^[A-Za-z0-9!_.*'()-]{1,150}$`)

type observabilityTenantGrant struct {
	Tenant   string   `json:"tenant"`
	Services []string `json:"services"`
}

func observabilityServiceName(module string) string {
	if module == "grafana-tempo" {
		return "tempo"
	}
	return "loki"
}

func observabilityTenantID(claim *unstructured.Unstructured) string {
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	tenant := strings.TrimSpace(fmt.Sprint(parameters["tenantId"]))
	if tenant == "" || tenant == "<nil>" {
		tenant = claim.GetName()
	}
	return tenant
}

func validObservabilityTenantID(value string) bool {
	return value != "." && value != ".." && observabilityTenantPattern.MatchString(value)
}

func observabilityTenantSecretName(claimName, service string) string {
	name := strings.ToLower(claimName + "-" + service + "-tenant")
	name = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(name, "-")
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func observabilityTokenDigest(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func decodeObservabilityGrants(value string) (map[string]observabilityTenantGrant, error) {
	grants := map[string]observabilityTenantGrant{}
	if strings.TrimSpace(value) == "" {
		return grants, nil
	}
	if err := json.Unmarshal([]byte(value), &grants); err != nil {
		return nil, err
	}
	return grants, nil
}

func (r *claimReconciler) mutateObservabilityGrant(ctx context.Context, digest string, grant *observabilityTenantGrant) error {
	key := types.NamespacedName{Namespace: r.cfg.managedNS, Name: observabilityTenantConfigName}
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		configMap := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
		err := r.direct.Get(ctx, key, configMap)
		if apierrors.IsNotFound(err) {
			if grant == nil {
				return nil
			}
			configMap = object(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, key.Namespace, key.Name)
			configMap.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-observability", lblModel: "observability", lblEngine: "tenant-gateway"})
			encoded, encodeErr := json.Marshal(map[string]observabilityTenantGrant{digest: *grant})
			if encodeErr != nil {
				return encodeErr
			}
			configMap.Object["data"] = map[string]interface{}{"tenants.json": string(encoded)}
			return r.direct.Create(ctx, configMap)
		}
		if err != nil {
			return err
		}
		current, _, _ := unstructured.NestedString(configMap.Object, "data", "tenants.json")
		grants, decodeErr := decodeObservabilityGrants(current)
		if decodeErr != nil {
			return fmt.Errorf("invalid %s/%s grant registry: %w", key.Namespace, key.Name, decodeErr)
		}
		if grant == nil {
			delete(grants, digest)
		} else {
			grants[digest] = *grant
		}
		encoded, encodeErr := json.Marshal(grants)
		if encodeErr != nil {
			return encodeErr
		}
		_ = unstructured.SetNestedField(configMap.Object, string(encoded), "data", "tenants.json")
		return r.direct.Update(ctx, configMap)
	})
}

func (r *claimReconciler) observabilityStoreReady(ctx context.Context, service string) bool {
	name := lokiName
	if service == "tempo" {
		name = tempoName
	}
	statefulSet := gvkObj(statefulSetGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: name}, statefulSet); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(statefulSet.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(statefulSet.Object, "status", "readyReplicas")
	gateway := gvkObj(depGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: observabilityGatewayName}, gateway); err != nil {
		return false
	}
	gatewayDesired, _, _ := unstructured.NestedInt64(gateway.Object, "spec", "replicas")
	gatewayReady, _, _ := unstructured.NestedInt64(gateway.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired && gatewayDesired > 0 && gatewayReady >= gatewayDesired
}

func (r *claimReconciler) ensureObservabilityTenantSecret(ctx context.Context, claim *unstructured.Unstructured, service, tenant string) (*unstructured.Unstructured, string, error) {
	name := observabilityTenantSecretName(claim.GetName(), service)
	key := types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, key, secret); err == nil {
		if secretString(secret, "tenant_id") != tenant || secretString(secret, "service") != service {
			return nil, "ObservabilityTenantDrift", nil
		}
		token := secretString(secret, "token")
		if len(token) < 32 {
			return nil, "ObservabilityTenantCredentialInvalid", nil
		}
		grant := &observabilityTenantGrant{Tenant: tenant, Services: []string{service}}
		if err := r.mutateObservabilityGrant(ctx, observabilityTokenDigest(token), grant); err != nil {
			return nil, "", err
		}
		return secret, "", nil
	} else if !apierrors.IsNotFound(err) {
		return nil, "", err
	}
	token, err := randomPassword(48)
	if err != nil {
		return nil, "", err
	}
	baseURL := "http://" + observabilityGatewayName + "." + r.cfg.managedNS + ".svc:8080/"
	if service == "tempo" {
		baseURL += "traces"
	} else {
		baseURL += "logs"
	}
	secret = object(coreSecretGVK, key.Namespace, key.Name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"token": base64.StdEncoding.EncodeToString([]byte(token)), "tenant_id": base64.StdEncoding.EncodeToString([]byte(tenant)),
		"service": base64.StdEncoding.EncodeToString([]byte(service)), "base_url": base64.StdEncoding.EncodeToString([]byte(baseURL)),
		"authorization": base64.StdEncoding.EncodeToString([]byte("Bearer " + token)),
	}
	secret.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-observability", lblModel: "observability", lblEngine: service, "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, "", err
	}
	grant := &observabilityTenantGrant{Tenant: tenant, Services: []string{service}}
	if err := r.mutateObservabilityGrant(ctx, observabilityTokenDigest(token), grant); err != nil {
		return nil, "", err
	}
	return secret, "", nil
}

func (r *claimReconciler) resolveObservabilityTenantBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	service := observabilityServiceName(contract.ID)
	if !r.observabilityStoreReady(ctx, service) {
		return serviceBindingProjection{}, "ObservabilityStoreNotReady", nil
	}
	endpoint := "http://" + observabilityGatewayName + "." + r.cfg.managedNS + ".svc:8080"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: observabilityGatewayName + "." + r.cfg.managedNS + ".svc:8080", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": observabilityGatewayName, "namespace": r.cfg.managedNS}}
	switch requestTypeOf(claim) {
	case "Instance":
		return projection, "", nil
	case "Tenant":
		tenant := observabilityTenantID(claim)
		if !validObservabilityTenantID(tenant) {
			return serviceBindingProjection{}, "InvalidObservabilityTenant", nil
		}
		secret, reason, err := r.ensureObservabilityTenantSecret(ctx, claim, service, tenant)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.Endpoint = secretString(secret, "base_url")
		projection.SecretRef = map[string]interface{}{"name": secret.GetName(), "namespace": secret.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "observability.opensphere.io/v1", "kind": "Tenant", "name": tenant, "namespace": claim.GetNamespace()}
		projection.Capabilities = append(projection.Capabilities, "tenant:"+tenant, "authenticated-gateway")
		return projection, "", nil
	case "Access":
		target := targetRefOf(claim)
		targetName := strings.TrimSpace(fmt.Sprint(target["name"]))
		if targetName == "" || targetName == "<nil>" {
			return serviceBindingProjection{}, "ObservabilityTenantTargetRequired", nil
		}
		secretName := observabilityTenantSecretName(targetName, service)
		secret := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
			return serviceBindingProjection{}, "ObservabilityTenantAccessNotReady", clientIgnoreNotFound(err)
		}
		projection.Endpoint = secretString(secret, "base_url")
		projection.SecretRef = map[string]interface{}{"name": secretName, "namespace": claim.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "observability.opensphere.io/v1", "kind": "TenantAccess", "name": targetName, "namespace": claim.GetNamespace()}
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func (r *claimReconciler) cleanupObservabilityTenantClaim(ctx context.Context, claim *unstructured.Unstructured, module string) (bool, error) {
	if requestTypeOf(claim) != "Tenant" {
		return true, nil
	}
	service := observabilityServiceName(module)
	name := observabilityTenantSecretName(claim.GetName(), service)
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, secret); err != nil {
		return apierrors.IsNotFound(err), clientIgnoreNotFound(err)
	}
	token := secretString(secret, "token")
	if token != "" {
		if err := r.mutateObservabilityGrant(ctx, observabilityTokenDigest(token), nil); err != nil {
			return false, err
		}
	}
	if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
		return false, err
	}
	return false, nil
}
