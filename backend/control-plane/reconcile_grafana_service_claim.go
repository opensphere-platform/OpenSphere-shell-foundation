package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var grafanaPortableName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$`)

func grafanaClaimResourceName(claim *unstructured.Unstructured, suffix string) string {
	base := strings.ToLower(claim.GetName())
	base = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "resource"
	}
	if len(base) > 36 {
		base = strings.TrimRight(base[:36], "-")
	}
	hash := sha256.Sum256([]byte(claim.GetNamespace() + "/" + claim.GetName() + "/" + suffix))
	return fmt.Sprintf("gf-%s-%x", base, hash[:5])
}

func stampGrafanaClaimOwnership(resource, claim *unstructured.Unstructured) {
	labels := resource.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[lblManagedBy] = cpManagedBy
	labels[lblPartOf] = "foundation-observability"
	labels[lblModel] = "observability"
	labels[lblEngine] = "grafana-operator"
	labels["foundation.opensphere.io/service-claim-namespace"] = claim.GetNamespace()
	labels["foundation.opensphere.io/service-claim"] = claim.GetName()
	labels["foundation.opensphere.io/service-claim-uid"] = string(claim.GetUID())
	resource.SetLabels(labels)
}

func grafanaClaimOwned(resource, claim *unstructured.Unstructured) bool {
	labels := resource.GetLabels()
	return labels["foundation.opensphere.io/service-claim-namespace"] == claim.GetNamespace() &&
		labels["foundation.opensphere.io/service-claim"] == claim.GetName() &&
		(string(claim.GetUID()) == "" || labels["foundation.opensphere.io/service-claim-uid"] == string(claim.GetUID()))
}

func (r *claimReconciler) resolveGrafanaServiceBinding(
	ctx context.Context,
	claim *unstructured.Unstructured,
	contract serviceModuleContract,
) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	instance := gvkObj(grafanaGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: grafanaName}, instance); err != nil {
		if meta.IsNoMatchError(err) {
			return serviceBindingProjection{}, "GrafanaOperatorNotInstalled", nil
		}
		if apierrors.IsNotFound(err) {
			return serviceBindingProjection{}, "GrafanaInstanceNotReady", nil
		}
		return serviceBindingProjection{}, "", err
	}
	if !grafanaObjectReady(instance) {
		return serviceBindingProjection{}, "GrafanaInstanceNotReady", nil
	}
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: grafanaEndpoint(r.cfg), Probe: grafanaProbe(r.cfg),
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef: map[string]interface{}{
			"apiVersion": grafanaGVK.Group + "/" + grafanaGVK.Version,
			"kind":       grafanaGVK.Kind,
			"name":       grafanaName,
			"namespace":  r.cfg.managedNS,
		},
	}
	switch requestTypeOf(claim) {
	case "Instance":
		return projection, "", nil
	case "Dashboard":
		resource, reason, err := r.ensureGrafanaDashboard(ctx, claim)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = grafanaResourceRef(resource)
		projection.Capabilities = append(projection.Capabilities, "dashboard:"+resource.GetName())
		return projection, "", nil
	case "DataSource":
		resource, reason, err := r.ensureGrafanaDatasource(ctx, claim)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = grafanaResourceRef(resource)
		projection.Capabilities = append(projection.Capabilities, "datasource:"+resource.GetName())
		return projection, "", nil
	case "Access":
		resource, binding, reason, err := r.ensureGrafanaAccess(ctx, claim)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = grafanaResourceRef(resource)
		projection.SecretRef = map[string]interface{}{"name": binding.GetName(), "namespace": binding.GetNamespace()}
		projection.Capabilities = append(projection.Capabilities, "service-account:"+resource.GetName())
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func grafanaResourceRef(resource *unstructured.Unstructured) map[string]interface{} {
	return map[string]interface{}{
		"apiVersion": resource.GetAPIVersion(), "kind": resource.GetKind(), "name": resource.GetName(), "namespace": resource.GetNamespace(),
	}
}

func (r *claimReconciler) applyOwnedGrafanaResource(ctx context.Context, desired, claim *unstructured.Unstructured) (string, error) {
	current := gvkObj(desired.GroupVersionKind())
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: desired.GetNamespace(), Name: desired.GetName()}, current)
	if err == nil && !grafanaClaimOwned(current, claim) {
		return "GrafanaResourceOwnershipConflict", nil
	}
	if err != nil && !apierrors.IsNotFound(err) {
		if meta.IsNoMatchError(err) {
			return "GrafanaOperatorNotInstalled", nil
		}
		return "", err
	}
	return "", applyObj(ctx, r.direct, desired)
}

func grafanaDashboardPayload(claim *unstructured.Unstructured) (map[string]interface{}, string) {
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	if raw, ok := parameters["json"]; ok {
		var document map[string]interface{}
		switch value := raw.(type) {
		case string:
			if len(value) > 900*1024 || json.Unmarshal([]byte(value), &document) != nil {
				return nil, "GrafanaDashboardJSONInvalid"
			}
		case map[string]interface{}:
			document = value
		default:
			return nil, "GrafanaDashboardJSONInvalid"
		}
		title := strings.TrimSpace(cleanInterfaceString(document["title"]))
		if title == "" || !grafanaPortableName.MatchString(title) {
			return nil, "GrafanaDashboardTitleInvalid"
		}
		encoded, err := json.Marshal(document)
		if err != nil || len(encoded) > 900*1024 {
			return nil, "GrafanaDashboardJSONInvalid"
		}
		return map[string]interface{}{"json": string(encoded)}, ""
	}
	if source, ok := parameters["grafanaCom"].(map[string]interface{}); ok {
		id := cleanInterfaceString(source["id"])
		revision := cleanInterfaceString(source["revision"])
		if !regexp.MustCompile(`^[1-9][0-9]{0,9}$`).MatchString(id) || !regexp.MustCompile(`^[1-9][0-9]{0,5}$`).MatchString(revision) {
			return nil, "GrafanaDashboardCatalogReferenceInvalid"
		}
		return map[string]interface{}{"grafanaCom": map[string]interface{}{"id": id, "revision": revision}}, ""
	}
	return nil, "GrafanaDashboardSourceRequired"
}

func (r *claimReconciler) ensureGrafanaDashboard(ctx context.Context, claim *unstructured.Unstructured) (*unstructured.Unstructured, string, error) {
	payload, reason := grafanaDashboardPayload(claim)
	if reason != "" {
		return nil, reason, nil
	}
	name := grafanaClaimResourceName(claim, "dashboard")
	dashboard := object(grafanaDashboardGVK, claim.GetNamespace(), name)
	spec := map[string]interface{}{
		"allowCrossNamespaceImport": true,
		"instanceSelector":          map[string]interface{}{"matchLabels": map[string]interface{}{grafanaSelectorKey: grafanaSelectorValue}},
		"resyncPeriod":              "5m",
		"uid":                       name,
	}
	for key, value := range payload {
		spec[key] = value
	}
	if folder := serviceClaimString(claim, claim.GetNamespace(), "folder"); grafanaPortableName.MatchString(folder) {
		spec["folder"] = folder
	} else {
		return nil, "GrafanaDashboardFolderInvalid", nil
	}
	dashboard.Object["spec"] = spec
	stampGrafanaClaimOwnership(dashboard, claim)
	if reason, err := r.applyOwnedGrafanaResource(ctx, dashboard, claim); err != nil || reason != "" {
		return nil, reason, err
	}
	current := gvkObj(grafanaDashboardGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: dashboard.GetNamespace(), Name: dashboard.GetName()}, current); err != nil {
		return nil, "GrafanaDashboardNotReady", nil
	}
	if noMatch, _, _ := unstructured.NestedBool(current.Object, "status", "NoMatchingInstances"); noMatch {
		return nil, "GrafanaDashboardInstanceSelectorMismatch", nil
	}
	ready, failed := grafanaSynchronized(current, "DashboardSynchronized")
	if failed {
		return nil, "GrafanaDashboardReconcileFailed", nil
	}
	if !ready {
		return nil, "GrafanaDashboardNotReady", nil
	}
	return current, "", nil
}

func grafanaDatasourceSpec(claim *unstructured.Unstructured) (map[string]interface{}, []interface{}, string) {
	name := serviceClaimString(claim, claim.GetName(), "name")
	typeName := serviceClaimString(claim, "", "type")
	endpoint := serviceClaimString(claim, "", "url")
	if !grafanaPortableName.MatchString(name) || !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(typeName) {
		return nil, nil, "GrafanaDatasourceIdentityInvalid"
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, nil, "GrafanaDatasourceURLInvalid"
	}
	datasource := map[string]interface{}{
		"name": name, "type": typeName, "url": endpoint, "access": "proxy",
		"editable": false, "isDefault": serviceClaimBool(claim, false, "isDefault"),
	}
	if secure, found, _ := unstructured.NestedMap(claim.Object, "spec", "parameters", "secureJsonData"); found && len(secure) > 0 {
		return nil, nil, "GrafanaDatasourceInlineSecretRejected"
	}
	if jsonData, found, _ := unstructured.NestedMap(claim.Object, "spec", "parameters", "jsonData"); found {
		if skip, ok := jsonData["tlsSkipVerify"].(bool); ok && skip {
			return nil, nil, "GrafanaDatasourceTLSVerificationRequired"
		}
		datasource["jsonData"] = jsonData
	}
	secretName, _, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if strings.TrimSpace(secretName) == "" {
		return datasource, nil, ""
	}
	auth := serviceClaimString(claim, "bearer", "auth")
	valuesFrom := []interface{}{}
	switch auth {
	case "basic":
		datasource["basicAuth"] = true
		datasource["basicAuthUser"] = "${GRAFANA_USERNAME}"
		datasource["secureJsonData"] = map[string]interface{}{"basicAuthPassword": "${GRAFANA_PASSWORD}"}
		valuesFrom = append(valuesFrom,
			grafanaSecretValue("basicAuthUser", secretName, "username"),
			grafanaSecretValue("secureJsonData.basicAuthPassword", secretName, "password"),
		)
	case "bearer":
		jsonData, _ := datasource["jsonData"].(map[string]interface{})
		if jsonData == nil {
			jsonData = map[string]interface{}{}
		}
		jsonData["httpHeaderName1"] = "Authorization"
		datasource["jsonData"] = jsonData
		datasource["secureJsonData"] = map[string]interface{}{"httpHeaderValue1": "Bearer ${GRAFANA_TOKEN}"}
		valuesFrom = append(valuesFrom, grafanaSecretValue("secureJsonData.httpHeaderValue1", secretName, "token"))
	default:
		return nil, nil, "GrafanaDatasourceAuthModeInvalid"
	}
	return datasource, valuesFrom, ""
}

func grafanaSecretValue(targetPath, secretName, key string) map[string]interface{} {
	return map[string]interface{}{
		"targetPath": targetPath,
		"valueFrom":  map[string]interface{}{"secretKeyRef": map[string]interface{}{"name": secretName, "key": key}},
	}
}

func (r *claimReconciler) ensureGrafanaDatasource(ctx context.Context, claim *unstructured.Unstructured) (*unstructured.Unstructured, string, error) {
	datasourceSpec, valuesFrom, reason := grafanaDatasourceSpec(claim)
	if reason != "" {
		return nil, reason, nil
	}
	if secretName, _, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name"); secretName != "" {
		secret := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
			return nil, "GrafanaDatasourceCredentialNotReady", nil
		}
	}
	name := grafanaClaimResourceName(claim, "datasource")
	datasource := object(grafanaDatasourceGVK, claim.GetNamespace(), name)
	spec := map[string]interface{}{
		"allowCrossNamespaceImport": true,
		"instanceSelector":          map[string]interface{}{"matchLabels": map[string]interface{}{grafanaSelectorKey: grafanaSelectorValue}},
		"datasource":                datasourceSpec,
		"resyncPeriod":              "5m",
		"uid":                       name,
	}
	if len(valuesFrom) > 0 {
		spec["valuesFrom"] = valuesFrom
	}
	datasource.Object["spec"] = spec
	stampGrafanaClaimOwnership(datasource, claim)
	if reason, err := r.applyOwnedGrafanaResource(ctx, datasource, claim); err != nil || reason != "" {
		return nil, reason, err
	}
	current := gvkObj(grafanaDatasourceGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: datasource.GetNamespace(), Name: datasource.GetName()}, current); err != nil {
		return nil, "GrafanaDatasourceNotReady", nil
	}
	if noMatch, _, _ := unstructured.NestedBool(current.Object, "status", "NoMatchingInstances"); noMatch {
		return nil, "GrafanaDatasourceInstanceSelectorMismatch", nil
	}
	ready, failed := grafanaSynchronized(current, "DatasourceSynchronized")
	if failed {
		return nil, "GrafanaDatasourceReconcileFailed", nil
	}
	if !ready {
		return nil, "GrafanaDatasourceNotReady", nil
	}
	return current, "", nil
}

func grafanaSynchronized(resource *unstructured.Unstructured, conditionType string) (ready, failed bool) {
	conditions, _, _ := unstructured.NestedSlice(resource.Object, "status", "conditions")
	generation := resource.GetGeneration()
	for _, item := range conditions {
		condition, ok := item.(map[string]interface{})
		if !ok || cleanInterfaceString(condition["type"]) != conditionType {
			continue
		}
		observed, _ := condition["observedGeneration"].(int64)
		if observed != 0 && generation != 0 && observed < generation {
			return false, false
		}
		status, reason := cleanInterfaceString(condition["status"]), cleanInterfaceString(condition["reason"])
		return status == "True" && reason == "ApplySuccessful", status == "False"
	}
	return false, false
}

func (r *claimReconciler) ensureGrafanaAccess(ctx context.Context, claim *unstructured.Unstructured) (*unstructured.Unstructured, *unstructured.Unstructured, string, error) {
	role := serviceClaimString(claim, "Viewer", "role")
	if role != "Viewer" && role != "Editor" && role != "Admin" {
		return nil, nil, "GrafanaAccessRoleInvalid", nil
	}
	name := grafanaClaimResourceName(claim, "access")
	tokenSecretName := name + "-token"
	serviceAccount := object(grafanaServiceAccountGVK, r.cfg.managedNS, name)
	token := map[string]interface{}{"name": "primary", "secretName": tokenSecretName}
	if expiresAt := serviceClaimString(claim, "", "expiresAt"); expiresAt != "" {
		expires, err := time.Parse(time.RFC3339, expiresAt)
		if err != nil || !expires.After(time.Now().UTC().Add(5*time.Minute)) {
			return nil, nil, "GrafanaAccessExpirationInvalid", nil
		}
		token["expires"] = expires.UTC().Format(time.RFC3339)
	}
	serviceAccount.Object["spec"] = map[string]interface{}{
		"instanceName": grafanaName,
		"name":         name,
		"role":         role,
		"resyncPeriod": "5m",
		"tokens":       []interface{}{token},
	}
	stampGrafanaClaimOwnership(serviceAccount, claim)
	if reason, err := r.applyOwnedGrafanaResource(ctx, serviceAccount, claim); err != nil || reason != "" {
		return nil, nil, reason, err
	}
	current := gvkObj(grafanaServiceAccountGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: serviceAccount.GetNamespace(), Name: serviceAccount.GetName()}, current); err != nil {
		return nil, nil, "GrafanaAccessNotReady", nil
	}
	ready, failed := grafanaSynchronized(current, "ServiceAccountSynchronized")
	if failed {
		return nil, nil, "GrafanaAccessReconcileFailed", nil
	}
	if !ready {
		return nil, nil, "GrafanaAccessNotReady", nil
	}
	internal := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: tokenSecretName}, internal); err != nil {
		return nil, nil, "GrafanaAccessTokenNotReady", nil
	}
	tokenValue := secretString(internal, "token")
	if tokenValue == "" {
		return nil, nil, "GrafanaAccessTokenInvalid", nil
	}
	binding := object(coreSecretGVK, claim.GetNamespace(), boundedGrafanaBindingName(claim.GetName()))
	binding.Object["type"] = "Opaque"
	binding.Object["data"] = map[string]interface{}{
		"endpoint": base64.StdEncoding.EncodeToString([]byte(grafanaEndpoint(r.cfg))),
		"token":    base64.StdEncoding.EncodeToString([]byte(tokenValue)),
		"role":     base64.StdEncoding.EncodeToString([]byte(role)),
	}
	stampGrafanaClaimOwnership(binding, claim)
	_ = unstructured.SetNestedSlice(binding.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, binding); err != nil {
		return nil, nil, "", err
	}
	return current, binding, "", nil
}

func boundedGrafanaBindingName(claimName string) string {
	name := claimName + "-grafana-access"
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func (r *claimReconciler) cleanupGrafanaServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	var targets []*unstructured.Unstructured
	switch requestTypeOf(claim) {
	case "Dashboard":
		targets = append(targets, object(grafanaDashboardGVK, claim.GetNamespace(), grafanaClaimResourceName(claim, "dashboard")))
	case "DataSource":
		targets = append(targets, object(grafanaDatasourceGVK, claim.GetNamespace(), grafanaClaimResourceName(claim, "datasource")))
	case "Access":
		targets = append(targets, object(grafanaServiceAccountGVK, r.cfg.managedNS, grafanaClaimResourceName(claim, "access")))
	default:
		return true, nil
	}
	for _, target := range targets {
		current := gvkObj(target.GroupVersionKind())
		err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.GetNamespace(), Name: target.GetName()}, current)
		if err == nil {
			if !grafanaClaimOwned(current, claim) {
				return false, fmt.Errorf("refusing to delete foreign Grafana resource %s/%s", current.GetKind(), current.GetName())
			}
			if err := r.direct.Delete(ctx, current); err != nil && !apierrors.IsNotFound(err) {
				return false, err
			}
			return false, nil
		}
		if !apierrors.IsNotFound(err) && !meta.IsNoMatchError(err) {
			return false, err
		}
	}
	if requestTypeOf(claim) == "Access" {
		for _, nn := range []types.NamespacedName{
			{Namespace: r.cfg.managedNS, Name: grafanaClaimResourceName(claim, "access") + "-token"},
			{Namespace: claim.GetNamespace(), Name: boundedGrafanaBindingName(claim.GetName())},
		} {
			secret := gvkObj(coreSecretGVK)
			err := r.direct.Get(ctx, nn, secret)
			if err == nil {
				if nn.Namespace == claim.GetNamespace() && !grafanaClaimOwned(secret, claim) {
					return false, fmt.Errorf("refusing to delete foreign Grafana binding Secret %s/%s", nn.Namespace, nn.Name)
				}
				if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
					return false, err
				}
				continue
			}
			if !apierrors.IsNotFound(err) {
				return false, client.IgnoreNotFound(err)
			}
		}
	}
	return true, nil
}
