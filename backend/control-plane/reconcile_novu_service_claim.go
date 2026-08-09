package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var (
	novuHTTPClient        = &http.Client{Timeout: 8 * time.Second}
	novuWorkflowIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,99}$`)
)

type novuSession struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func (s *novuSession) request(ctx context.Context, method, path string, payload interface{}, idempotencyKey string) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.baseURL, "/")+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "ApiKey "+s.apiKey)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("idempotency-key", idempotencyKey)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	return resp.StatusCode, response, err
}

func novuOwnerTags(claim *unstructured.Unstructured) []string {
	return []string{
		"opensphere-managed",
		"opensphere-claim-namespace:" + claim.GetNamespace(),
		"opensphere-claim-name:" + claim.GetName(),
	}
}

func stringSlice(value interface{}) []string {
	raw, ok := value.([]interface{})
	if !ok {
		if values, valid := value.([]string); valid {
			return append([]string(nil), values...)
		}
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, valid := item.(string); valid && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}
	return result
}

func mergeStringSlices(values ...[]string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, group := range values {
		for _, item := range group {
			if item != "" && !seen[item] {
				seen[item] = true
				result = append(result, item)
			}
		}
	}
	sort.Strings(result)
	return result
}

func novuWorkflowSpec(claim *unstructured.Unstructured) (string, map[string]interface{}, bool) {
	workflow, found, _ := unstructured.NestedMap(claim.Object, "spec", "parameters", "workflow")
	if !found {
		return "", nil, false
	}
	workflowID := strings.TrimSpace(fmt.Sprint(workflow["workflowId"]))
	name := strings.TrimSpace(fmt.Sprint(workflow["name"]))
	steps, stepsOK := workflow["steps"].([]interface{})
	if !novuWorkflowIDPattern.MatchString(workflowID) || name == "" || !stepsOK || len(steps) == 0 {
		return "", nil, false
	}
	workflow["workflowId"] = workflowID
	workflow["name"] = name
	workflow["steps"] = steps
	workflow["tags"] = mergeStringSlices(stringSlice(workflow["tags"]), novuOwnerTags(claim))
	workflow["__source"] = "editor"
	return workflowID, workflow, true
}

func responseWorkflowTags(body []byte) []string {
	var payload map[string]interface{}
	if json.Unmarshal(body, &payload) != nil {
		return nil
	}
	if data, ok := payload["data"].(map[string]interface{}); ok {
		payload = data
	}
	return stringSlice(payload["tags"])
}

func containsAll(values, required []string) bool {
	set := map[string]bool{}
	for _, value := range values {
		set[value] = true
	}
	for _, value := range required {
		if !set[value] {
			return false
		}
	}
	return true
}

func (s *novuSession) upsertWorkflow(ctx context.Context, claim *unstructured.Unstructured, workflowID string, workflow map[string]interface{}) (string, error) {
	path := "/v2/workflows/" + url.PathEscape(workflowID)
	status, body, err := s.request(ctx, http.MethodGet, path, nil, "")
	if err != nil {
		return "", err
	}
	if status == http.StatusOK {
		if !containsAll(responseWorkflowTags(body), novuOwnerTags(claim)) {
			return "NovuWorkflowOwnershipConflict", nil
		}
		status, _, err = s.request(ctx, http.MethodPut, path, workflow, "")
		if err != nil {
			return "", err
		}
		if status != http.StatusOK {
			return "NovuWorkflowUpdateFailed", nil
		}
		return "", nil
	}
	if status != http.StatusNotFound {
		return "NovuWorkflowQueryFailed", nil
	}
	idempotencyKey := "foundation-claim-" + strings.ReplaceAll(string(claim.GetUID()), ":", "-")
	if idempotencyKey == "foundation-claim-" {
		idempotencyKey = "foundation-claim-" + claim.GetNamespace() + "-" + claim.GetName()
	}
	status, _, err = s.request(ctx, http.MethodPost, "/v2/workflows", workflow, idempotencyKey)
	if err != nil {
		return "", err
	}
	if status != http.StatusCreated && status != http.StatusOK {
		return "NovuWorkflowCreateFailed", nil
	}
	return "", nil
}

func (s *novuSession) deleteOwnedWorkflow(ctx context.Context, claim *unstructured.Unstructured, workflowID string) (bool, error) {
	path := "/v2/workflows/" + url.PathEscape(workflowID)
	status, body, err := s.request(ctx, http.MethodGet, path, nil, "")
	if err != nil {
		return false, err
	}
	if status == http.StatusNotFound {
		return true, nil
	}
	if status != http.StatusOK {
		return false, nil
	}
	if !containsAll(responseWorkflowTags(body), novuOwnerTags(claim)) {
		// Never delete a workflow that the controller cannot prove it owns.
		return true, nil
	}
	status, _, err = s.request(ctx, http.MethodDelete, path, nil, "")
	if err != nil {
		return false, err
	}
	return status == http.StatusNoContent || status == http.StatusOK || status == http.StatusNotFound, nil
}

func (r *claimReconciler) novuSession(ctx context.Context, credential *unstructured.Unstructured) (*novuSession, string, error) {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: novuAPIName}, deployment); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "NovuNotReady", nil
		}
		return nil, "", err
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	if desired < 1 || ready < desired {
		return nil, "NovuNotReady", nil
	}
	if credential == nil {
		credential = gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: communicationRuntimeSecret}, credential); err != nil {
			if apierrors.IsNotFound(err) {
				return nil, "NovuOperatorCredentialNotReady", nil
			}
			return nil, "", err
		}
	}
	apiKey := secretString(credential, "api_key")
	if apiKey == "" {
		apiKey = secretString(credential, "novu-secret-key")
	}
	if len(apiKey) < 24 {
		return nil, "NovuCredentialInvalid", nil
	}
	baseURL := secretString(credential, "base_url")
	if baseURL == "" {
		baseURL = "http://" + novuAPIName + "." + r.cfg.managedNS + ".svc:3000"
	}
	return &novuSession{baseURL: baseURL, apiKey: apiKey, client: novuHTTPClient}, "", nil
}

func (r *claimReconciler) resolveNovuServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	endpoint := "http://" + novuAPIName + "." + r.cfg.managedNS + ".svc:3000"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: novuAPIName + "." + r.cfg.managedNS + ".svc:3000", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": novuAPIName, "namespace": r.cfg.managedNS}}
	switch requestTypeOf(claim) {
	case "Instance":
		return projection, "", nil
	case "Workflow":
		workflowID, workflow, valid := novuWorkflowSpec(claim)
		if !valid {
			return serviceBindingProjection{}, "InvalidNovuWorkflow", nil
		}
		session, reason, sessionErr := r.novuSession(ctx, nil)
		if sessionErr != nil || reason != "" {
			return serviceBindingProjection{}, reason, sessionErr
		}
		if reason, err := session.upsertWorkflow(ctx, claim, workflowID, workflow); err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "novu.opensphere.io/v1", "kind": "Workflow", "name": workflowID, "namespace": claim.GetNamespace()}
		projection.Capabilities = append(projection.Capabilities, "workflow:"+workflowID)
		return projection, "", nil
	case "Access":
		secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
		if !found || strings.TrimSpace(secretName) == "" {
			return serviceBindingProjection{}, "NovuCredentialSecretRequired", nil
		}
		secret := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
			return serviceBindingProjection{}, "NovuCredentialNotReady", clientIgnoreNotFound(err)
		}
		session, reason, sessionErr := r.novuSession(ctx, secret)
		if sessionErr != nil || reason != "" {
			return serviceBindingProjection{}, reason, sessionErr
		}
		status, _, requestErr := session.request(ctx, http.MethodGet, "/v2/workflows?limit=1", nil, "")
		if requestErr != nil || status != http.StatusOK {
			return serviceBindingProjection{}, "NovuCredentialVerificationFailed", nil
		}
		projection.SecretRef = map[string]interface{}{"name": secretName, "namespace": claim.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "novu.opensphere.io/v1", "kind": "EnvironmentAccess", "name": claim.GetName(), "namespace": claim.GetNamespace()}
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func (r *claimReconciler) cleanupNovuServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) != "Workflow" {
		return true, nil
	}
	workflowID, _, valid := novuWorkflowSpec(claim)
	if !valid {
		return true, nil
	}
	session, reason, err := r.novuSession(ctx, nil)
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	return session.deleteOwnedWorkflow(ctx, claim, workflowID)
}
