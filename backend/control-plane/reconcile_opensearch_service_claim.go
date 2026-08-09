package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var openSearchIndexPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,254}$`)

var openSearchHTTPClient = &http.Client{Timeout: 8 * time.Second}

var openSearchAccessPattern = regexp.MustCompile(`^[a-z0-9*?._-]{1,255}$`)

type basicAuthTransport struct {
	base               http.RoundTripper
	username, password string
}

func (t basicAuthTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.SetBasicAuth(t.username, t.password)
	return t.base.RoundTrip(clone)
}

func (r *claimReconciler) openSearchAdminClient(ctx context.Context, namespace string) (*http.Client, string, error) {
	credential := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: openSearchAdminSecretName}, credential); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "OpenSearchAdminCredentialNotReady", nil
		}
		return nil, "", err
	}
	username, password := secretString(credential, "username"), secretString(credential, "password")
	if username == "" || password == "" {
		return nil, "OpenSearchAdminCredentialInvalid", nil
	}
	ca := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: osStatefulSetName + "-ca"}, ca); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "OpenSearchCAReadyPending", nil
		}
		return nil, "", err
	}
	caPEM := secretString(ca, "ca.crt")
	pool := x509.NewCertPool()
	if caPEM == "" || !pool.AppendCertsFromPEM([]byte(caPEM)) {
		return nil, "OpenSearchCAInvalid", nil
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}}
	return &http.Client{Timeout: 8 * time.Second, Transport: basicAuthTransport{base: transport, username: username, password: password}}, "", nil
}

func openSearchAccessName(claim *unstructured.Unstructured) string {
	base := strings.ToLower(claim.GetName())
	base = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "access"
	}
	if len(base) > 40 {
		base = strings.TrimRight(base[:40], "-")
	}
	hash := sha256.Sum256([]byte(claim.GetNamespace() + "/" + claim.GetName()))
	return fmt.Sprintf("os-%s-%x", base, hash[:5])
}

func openSearchClaimOwned(resource, claim *unstructured.Unstructured) bool {
	labels := resource.GetLabels()
	return labels["foundation.opensphere.io/service-claim-namespace"] == claim.GetNamespace() &&
		labels["foundation.opensphere.io/service-claim"] == claim.GetName() &&
		(string(claim.GetUID()) == "" || labels["foundation.opensphere.io/service-claim-uid"] == string(claim.GetUID()))
}

func stampOpenSearchClaimOwnership(resource, claim *unstructured.Unstructured) {
	labels := resource.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[lblManagedBy] = cpManagedBy
	labels[lblPartOf] = "foundation-data"
	labels[lblModel] = "data"
	labels[lblEngine] = "opensearch"
	labels["foundation.opensphere.io/service-claim-namespace"] = claim.GetNamespace()
	labels["foundation.opensphere.io/service-claim"] = claim.GetName()
	labels["foundation.opensphere.io/service-claim-uid"] = string(claim.GetUID())
	resource.SetLabels(labels)
}

func (r *claimReconciler) resolveOpenSearchServiceBinding(
	ctx context.Context,
	claim, model *unstructured.Unstructured,
	contract serviceModuleContract,
) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	namespace := opensearchNS(r.cfg, model)
	if !r.openSearchReady(ctx, namespace) {
		return serviceBindingProjection{}, "OpenSearchNotReady", nil
	}
	baseURL := opensearchEndpoint(r.cfg, model)
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: baseURL, Probe: opensearchProbe(r.cfg, model),
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef: map[string]interface{}{
			"apiVersion": "opensearch.opster.io/v1", "kind": "OpenSearchCluster", "name": osStatefulSetName, "namespace": namespace,
		},
	}
	switch requestTypeOf(claim) {
	case "Instance":
		return projection, "", nil
	case "Access":
		secret, user, reason, err := r.ensureOpenSearchAccess(ctx, claim, namespace, baseURL)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.SecretRef = map[string]interface{}{"name": secret.GetName(), "namespace": secret.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "opensearch.opster.io/v1", "kind": "OpensearchUser", "name": user, "namespace": namespace}
		projection.Capabilities = append(projection.Capabilities, "principal:"+user)
		return projection, "", nil
	case "Index":
		index := serviceClaimString(claim, claim.GetName(), "index")
		if !validOpenSearchIndex(index) {
			return serviceBindingProjection{}, "InvalidRequest", nil
		}
		body, valid := openSearchIndexBody(claim)
		if !valid {
			return serviceBindingProjection{}, "InvalidRequest", nil
		}
		adminClient, reason, err := r.openSearchAdminClient(ctx, namespace)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		ready, err := ensureOpenSearchIndex(ctx, adminClient, baseURL, index, body)
		if err != nil {
			return serviceBindingProjection{}, "OpenSearchIndexReconcileFailed", nil
		}
		if !ready {
			return serviceBindingProjection{}, "OpenSearchIndexNotReady", nil
		}
		projection.Endpoint = strings.TrimRight(baseURL, "/") + "/" + index
		projection.Capabilities = append(projection.Capabilities, "index:"+index)
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func openSearchAccessPolicy(claim *unstructured.Unstructured) ([]string, []string, []string, string) {
	patterns, _, _ := unstructured.NestedStringSlice(claim.Object, "spec", "parameters", "indexPatterns")
	if len(patterns) == 0 {
		if target := targetRefOf(claim); target != nil {
			if name := strings.TrimSpace(cleanInterfaceString(target["name"])); name != "" {
				patterns = []string{name}
			}
		}
	}
	seen := map[string]bool{}
	validated := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		pattern = strings.ToLower(strings.TrimSpace(pattern))
		if !openSearchAccessPattern.MatchString(pattern) || strings.HasPrefix(pattern, "_") || pattern == "." || pattern == ".." {
			return nil, nil, nil, "OpenSearchIndexPatternsInvalid"
		}
		if !seen[pattern] {
			seen[pattern] = true
			validated = append(validated, pattern)
		}
	}
	if len(validated) == 0 {
		return nil, nil, nil, "OpenSearchIndexPatternsRequired"
	}
	access := serviceClaimString(claim, "ReadOnly", "access")
	switch access {
	case "ReadOnly":
		return validated, []string{"cluster_composite_ops_ro"}, []string{"read", "indices_monitor"}, ""
	case "ReadWrite":
		return validated, []string{"cluster_composite_ops_ro"}, []string{"read", "write", "create_index", "indices_monitor"}, ""
	default:
		return nil, nil, nil, "OpenSearchAccessModeInvalid"
	}
}

func (r *claimReconciler) ensureOpenSearchInternalCredential(ctx context.Context, claim *unstructured.Unstructured, namespace, name string) (*unstructured.Unstructured, string, error) {
	secretName := name + "-password"
	secret := gvkObj(coreSecretGVK)
	nn := types.NamespacedName{Namespace: namespace, Name: secretName}
	err := r.direct.Get(ctx, nn, secret)
	if err == nil {
		if !openSearchClaimOwned(secret, claim) {
			return nil, "OpenSearchAccessOwnershipConflict", nil
		}
		if secretString(secret, "password") == "" {
			return nil, "OpenSearchAccessCredentialInvalid", nil
		}
		return secret, "", nil
	}
	if !apierrors.IsNotFound(err) {
		return nil, "", err
	}
	password, err := randomServicePassword(36)
	if err != nil {
		return nil, "", err
	}
	secret = object(coreSecretGVK, namespace, secretName)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"username": base64.StdEncoding.EncodeToString([]byte(name)),
		"password": base64.StdEncoding.EncodeToString([]byte(password)),
	}
	stampOpenSearchClaimOwnership(secret, claim)
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, "", err
	}
	if err := r.direct.Get(ctx, nn, secret); err != nil {
		return nil, "", err
	}
	return secret, "", nil
}

func (r *claimReconciler) ensureOpenSearchAccess(ctx context.Context, claim *unstructured.Unstructured, namespace, endpoint string) (*unstructured.Unstructured, string, string, error) {
	patterns, clusterActions, indexActions, reason := openSearchAccessPolicy(claim)
	if reason != "" {
		return nil, "", reason, nil
	}
	name := openSearchAccessName(claim)
	roleName := name + "-role"
	credential, reason, err := r.ensureOpenSearchInternalCredential(ctx, claim, namespace, name)
	if err != nil || reason != "" {
		return nil, "", reason, err
	}
	role := object(openSearchRoleGVK, namespace, roleName)
	role.Object["spec"] = map[string]interface{}{
		"opensearchCluster":  map[string]interface{}{"name": osStatefulSetName},
		"clusterPermissions": stringSliceInterface(clusterActions),
		"indexPermissions": []interface{}{map[string]interface{}{
			"indexPatterns": stringSliceInterface(patterns), "allowedActions": stringSliceInterface(indexActions),
		}},
	}
	stampOpenSearchClaimOwnership(role, claim)
	if reason, err := r.applyOwnedOpenSearchResource(ctx, role, claim); err != nil || reason != "" {
		return nil, "", reason, err
	}
	user := object(openSearchUserGVK, namespace, name)
	user.Object["spec"] = map[string]interface{}{
		"opensearchCluster":       map[string]interface{}{"name": osStatefulSetName},
		"passwordFrom":            map[string]interface{}{"name": credential.GetName(), "key": "password"},
		"opendistroSecurityRoles": []interface{}{roleName},
		"attributes": map[string]interface{}{
			"opensphere_claim_namespace": claim.GetNamespace(), "opensphere_claim_name": claim.GetName(),
		},
	}
	stampOpenSearchClaimOwnership(user, claim)
	if reason, err := r.applyOwnedOpenSearchResource(ctx, user, claim); err != nil || reason != "" {
		return nil, "", reason, err
	}
	currentRole, currentUser := gvkObj(openSearchRoleGVK), gvkObj(openSearchUserGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: roleName}, currentRole); err != nil {
		return nil, "", "OpenSearchRoleNotReady", nil
	}
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, currentUser); err != nil {
		return nil, "", "OpenSearchUserNotReady", nil
	}
	roleState, _, _ := unstructured.NestedString(currentRole.Object, "status", "state")
	userState, _, _ := unstructured.NestedString(currentUser.Object, "status", "state")
	if roleState == "ERROR" || userState == "ERROR" {
		return nil, "", "OpenSearchAccessReconcileFailed", nil
	}
	if roleState != "CREATED" || userState != "CREATED" {
		return nil, "", "OpenSearchAccessNotReady", nil
	}
	ca := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: osStatefulSetName + "-ca"}, ca); err != nil {
		return nil, "", "OpenSearchCAReadyPending", nil
	}
	caPEM := secretString(ca, "ca.crt")
	if caPEM == "" {
		return nil, "", "OpenSearchCAInvalid", nil
	}
	password := secretString(credential, "password")
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, "", "", err
	}
	parsed.User = url.UserPassword(name, password)
	bindingName := boundedOpenSearchBindingName(claim.GetName())
	binding := object(coreSecretGVK, claim.GetNamespace(), bindingName)
	binding.Object["type"] = "Opaque"
	binding.Object["data"] = map[string]interface{}{
		"username": base64.StdEncoding.EncodeToString([]byte(name)),
		"password": base64.StdEncoding.EncodeToString([]byte(password)),
		"endpoint": base64.StdEncoding.EncodeToString([]byte(endpoint)),
		"uri":      base64.StdEncoding.EncodeToString([]byte(parsed.String())),
		"ca.crt":   base64.StdEncoding.EncodeToString([]byte(caPEM)),
	}
	stampOpenSearchClaimOwnership(binding, claim)
	_ = unstructured.SetNestedSlice(binding.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, binding); err != nil {
		return nil, "", "", err
	}
	return binding, name, "", nil
}

func stringSliceInterface(values []string) []interface{} {
	result := make([]interface{}, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func (r *claimReconciler) applyOwnedOpenSearchResource(ctx context.Context, desired, claim *unstructured.Unstructured) (string, error) {
	current := gvkObj(desired.GroupVersionKind())
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: desired.GetNamespace(), Name: desired.GetName()}, current)
	if err == nil && !openSearchClaimOwned(current, claim) {
		return "OpenSearchAccessOwnershipConflict", nil
	}
	if err != nil && !apierrors.IsNotFound(err) {
		return "", err
	}
	return "", applyObj(ctx, r.direct, desired)
}

func (r *claimReconciler) openSearchReady(ctx context.Context, namespace string) bool {
	cluster := gvkObj(openSearchClusterGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: osStatefulSetName}, cluster); err != nil {
		return false
	}
	phase, _, _ := unstructured.NestedString(cluster.Object, "status", "phase")
	health, _, _ := unstructured.NestedString(cluster.Object, "status", "health")
	return phase == "RUNNING" && (health == "green" || health == "yellow")
}

func validOpenSearchIndex(index string) bool {
	return openSearchIndexPattern.MatchString(index) && index != "." && index != ".." && !strings.HasPrefix(index, "_")
}

func openSearchIndexBody(claim *unstructured.Unstructured) (map[string]interface{}, bool) {
	shards := serviceClaimInt(claim, 1, "shards")
	replicas := serviceClaimInt(claim, 0, "replicas")
	if shards < 1 || shards > 100 || replicas < 0 || replicas > 9 {
		return nil, false
	}
	body := map[string]interface{}{
		"settings": map[string]interface{}{"number_of_shards": shards, "number_of_replicas": replicas},
	}
	if mappings, found, _ := unstructured.NestedMap(claim.Object, "spec", "parameters", "mappings"); found && len(mappings) > 0 {
		body["mappings"] = mappings
	}
	return body, true
}

func ensureOpenSearchIndex(ctx context.Context, client *http.Client, baseURL, index string, body map[string]interface{}) (bool, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return false, err
	}
	status, response, err := openSearchRequest(ctx, client, http.MethodPut, strings.TrimRight(baseURL, "/")+"/"+index, encoded)
	if err != nil {
		return false, err
	}
	if status != http.StatusOK && status != http.StatusCreated && !(status == http.StatusBadRequest && bytes.Contains(response, []byte("resource_already_exists_exception"))) {
		return false, fmt.Errorf("OpenSearch index PUT returned HTTP %d: %s", status, strings.TrimSpace(string(response)))
	}
	healthURL := strings.TrimRight(baseURL, "/") + "/_cluster/health/" + index + "?wait_for_status=yellow&timeout=5s"
	status, response, err = openSearchRequest(ctx, client, http.MethodGet, healthURL, nil)
	if err != nil || status != http.StatusOK {
		return false, err
	}
	var health struct {
		Status   string `json:"status"`
		TimedOut bool   `json:"timed_out"`
	}
	if err := json.Unmarshal(response, &health); err != nil {
		return false, err
	}
	return !health.TimedOut && (health.Status == "yellow" || health.Status == "green"), nil
}

func openSearchRequest(ctx context.Context, client *http.Client, method, url string, body []byte) (int, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("content-type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, payload, err
}

func (r *claimReconciler) cleanupOpenSearchServiceClaim(ctx context.Context, claim, model *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) == "Access" {
		return r.cleanupOpenSearchAccess(ctx, claim, opensearchNS(r.cfg, model))
	}
	if requestTypeOf(claim) != "Index" || serviceClaimString(claim, "Retain", "deletionPolicy") != "Delete" {
		return true, nil
	}
	index := serviceClaimString(claim, claim.GetName(), "index")
	if !validOpenSearchIndex(index) {
		return true, nil
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	adminClient, reason, err := r.openSearchAdminClient(cleanupCtx, opensearchNS(r.cfg, model))
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	status, payload, err := openSearchRequest(cleanupCtx, adminClient, http.MethodDelete, strings.TrimRight(opensearchEndpoint(r.cfg, model), "/")+"/"+index, nil)
	if err != nil {
		return false, err
	}
	if status != http.StatusOK && status != http.StatusNotFound {
		return false, fmt.Errorf("OpenSearch index DELETE returned HTTP %d: %s", status, strings.TrimSpace(string(payload)))
	}
	return true, nil
}

func (r *claimReconciler) cleanupOpenSearchAccess(ctx context.Context, claim *unstructured.Unstructured, namespace string) (bool, error) {
	name := openSearchAccessName(claim)
	for _, target := range []*unstructured.Unstructured{
		object(openSearchUserGVK, namespace, name),
		object(openSearchRoleGVK, namespace, name+"-role"),
	} {
		current := gvkObj(target.GroupVersionKind())
		err := r.direct.Get(ctx, types.NamespacedName{Namespace: target.GetNamespace(), Name: target.GetName()}, current)
		if err == nil {
			if !openSearchClaimOwned(current, claim) {
				return false, fmt.Errorf("refusing to delete foreign OpenSearch resource %s/%s", current.GetKind(), current.GetName())
			}
			if err := r.direct.Delete(ctx, current); err != nil && !apierrors.IsNotFound(err) {
				return false, err
			}
			return false, nil
		}
		if !apierrors.IsNotFound(err) {
			return false, err
		}
	}
	for _, nn := range []types.NamespacedName{
		{Namespace: namespace, Name: name + "-password"},
		{Namespace: claim.GetNamespace(), Name: boundedOpenSearchBindingName(claim.GetName())},
	} {
		secret := gvkObj(coreSecretGVK)
		err := r.direct.Get(ctx, nn, secret)
		if err == nil {
			if !openSearchClaimOwned(secret, claim) {
				return false, fmt.Errorf("refusing to delete foreign OpenSearch Secret %s/%s", nn.Namespace, nn.Name)
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
	return true, nil
}

func boundedOpenSearchBindingName(claimName string) string {
	name := claimName + "-opensearch-access"
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}
