package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const liteLLMCredentialSuffix = "-litellm-access"

var liteLLMHTTPClient = &http.Client{Timeout: 8 * time.Second}

type liteLLMSession struct {
	baseURL   string
	masterKey string
	client    *http.Client
}

type liteLLMRouteRecord struct {
	ID            string
	ModelName     string
	LiteLLMParams map[string]interface{}
	ModelInfo     map[string]interface{}
}

func (s *liteLLMSession) request(ctx context.Context, method, path string, payload interface{}) (int, []byte, error) {
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
	req.Header.Set("authorization", "Bearer "+s.masterKey)
	if payload != nil {
		req.Header.Set("content-type", "application/json")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, response, err
}

func (s *liteLLMSession) keyExists(ctx context.Context, key string) (bool, error) {
	status, _, err := s.request(ctx, http.MethodGet, "/key/info?key="+url.QueryEscape(key), nil)
	if err != nil {
		return false, err
	}
	if status == http.StatusNotFound || status == http.StatusBadRequest {
		return false, nil
	}
	if status != http.StatusOK {
		return false, fmt.Errorf("LiteLLM key info returned HTTP %d", status)
	}
	return true, nil
}

func (s *liteLLMSession) generateKey(ctx context.Context, claim *unstructured.Unstructured, models []string) (string, string, error) {
	payload := map[string]interface{}{
		"key_alias": "opensphere:" + claim.GetNamespace() + "/" + claim.GetName(),
		"models":    models,
		"metadata": map[string]interface{}{
			"managed_by": "foundation-control-plane", "claim_namespace": claim.GetNamespace(),
			"claim_name": claim.GetName(), "claim_uid": string(claim.GetUID()),
		},
	}
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	for _, item := range []struct{ source, target string }{{"maxBudget", "max_budget"}, {"tpmLimit", "tpm_limit"}, {"rpmLimit", "rpm_limit"}} {
		if value, found := parameters[item.source]; found {
			payload[item.target] = value
		}
	}
	status, response, err := s.request(ctx, http.MethodPost, "/key/generate", payload)
	if err != nil {
		return "", "", err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return "", "", fmt.Errorf("LiteLLM key generate returned HTTP %d", status)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(response, &result); err != nil {
		return "", "", err
	}
	key := strings.TrimSpace(fmt.Sprint(result["key"]))
	if key == "" || key == "<nil>" {
		return "", "", fmt.Errorf("LiteLLM key generate response omitted key")
	}
	tokenID := strings.TrimSpace(fmt.Sprint(result["token_id"]))
	if tokenID == "<nil>" {
		tokenID = ""
	}
	return key, tokenID, nil
}

func (s *liteLLMSession) deleteKey(ctx context.Context, key string) error {
	status, _, err := s.request(ctx, http.MethodPost, "/key/delete", map[string]interface{}{"keys": []string{key}})
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound {
		return fmt.Errorf("LiteLLM key delete returned HTTP %d", status)
	}
	return nil
}

func (s *liteLLMSession) routes(ctx context.Context) ([]liteLLMRouteRecord, error) {
	status, response, err := s.request(ctx, http.MethodGet, "/v1/model/info", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("LiteLLM model info returned HTTP %d", status)
	}
	var decoded interface{}
	if err := json.Unmarshal(response, &decoded); err != nil {
		return nil, err
	}
	items := []interface{}{}
	switch value := decoded.(type) {
	case []interface{}:
		items = value
	case map[string]interface{}:
		for _, key := range []string{"data", "models", "model_info"} {
			if candidate, ok := value[key].([]interface{}); ok {
				items = candidate
				break
			}
		}
	}
	records := make([]liteLLMRouteRecord, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		modelInfo, _ := entry["model_info"].(map[string]interface{})
		params, _ := entry["litellm_params"].(map[string]interface{})
		id := cleanInterfaceString(entry["model_id"])
		if id == "" {
			id = cleanInterfaceString(entry["id"])
		}
		if id == "" {
			id = cleanInterfaceString(modelInfo["id"])
		}
		records = append(records, liteLLMRouteRecord{
			ID: id, ModelName: cleanInterfaceString(entry["model_name"]), LiteLLMParams: params, ModelInfo: modelInfo,
		})
	}
	return records, nil
}

func cleanInterfaceString(value interface{}) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func routeOwnedByClaim(record liteLLMRouteRecord, claim *unstructured.Unstructured) bool {
	if record.ModelInfo == nil || cleanInterfaceString(record.ModelInfo["opensphere_managed"]) != "true" {
		return false
	}
	if cleanInterfaceString(record.ModelInfo["opensphere_claim_namespace"]) != claim.GetNamespace() ||
		cleanInterfaceString(record.ModelInfo["opensphere_claim_name"]) != claim.GetName() {
		return false
	}
	uid := strings.TrimSpace(string(claim.GetUID()))
	return uid == "" || cleanInterfaceString(record.ModelInfo["opensphere_claim_uid"]) == uid
}

func (s *liteLLMSession) createRoute(ctx context.Context, modelName string, params, modelInfo map[string]interface{}) (string, error) {
	status, response, err := s.request(ctx, http.MethodPost, "/model/new", map[string]interface{}{
		"model_name": modelName, "litellm_params": params, "model_info": modelInfo,
	})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return "", fmt.Errorf("LiteLLM model create returned HTTP %d", status)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(response, &result); err != nil {
		return "", err
	}
	id := cleanInterfaceString(result["model_id"])
	if id == "" {
		id = cleanInterfaceString(result["id"])
	}
	if returned, ok := result["model_info"].(map[string]interface{}); ok && id == "" {
		id = cleanInterfaceString(returned["id"])
	}
	return id, nil
}

func (s *liteLLMSession) updateRoute(ctx context.Context, id, modelName string, params, modelInfo map[string]interface{}) error {
	status, _, err := s.request(ctx, http.MethodPatch, "/model/"+url.PathEscape(id)+"/update", map[string]interface{}{
		"model_name": modelName, "litellm_params": params, "model_info": modelInfo,
	})
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent {
		return fmt.Errorf("LiteLLM model update returned HTTP %d", status)
	}
	return nil
}

func (s *liteLLMSession) deleteRoute(ctx context.Context, id string) error {
	status, _, err := s.request(ctx, http.MethodPost, "/model/delete", map[string]interface{}{"id": id})
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound {
		return fmt.Errorf("LiteLLM model delete returned HTTP %d", status)
	}
	return nil
}

func (s *liteLLMSession) ensureRoute(ctx context.Context, claim *unstructured.Unstructured, modelName string, params, modelInfo map[string]interface{}) (string, string, error) {
	records, err := s.routes(ctx)
	if err != nil {
		return "", "LiteLLMRouteQueryFailed", nil
	}
	var existing *liteLLMRouteRecord
	for i := range records {
		if records[i].ModelName != modelName {
			continue
		}
		if existing != nil {
			return "", "LiteLLMRouteNameAmbiguous", nil
		}
		existing = &records[i]
	}
	if existing != nil && !routeOwnedByClaim(*existing, claim) {
		return "", "LiteLLMRouteOwnershipConflict", nil
	}
	desiredHash := cleanInterfaceString(modelInfo["opensphere_spec_hash"])
	if existing == nil {
		id, createErr := s.createRoute(ctx, modelName, params, modelInfo)
		if createErr != nil {
			return "", "LiteLLMRouteCreateFailed", nil
		}
		if id == "" {
			records, err = s.routes(ctx)
			if err != nil {
				return "", "LiteLLMRouteQueryFailed", nil
			}
			for i := range records {
				if records[i].ModelName == modelName && routeOwnedByClaim(records[i], claim) {
					id = records[i].ID
					break
				}
			}
		}
		if id == "" {
			return "", "LiteLLMRouteIdentityMissing", nil
		}
		return id, "", nil
	}
	if existing.ID == "" {
		return "", "LiteLLMRouteIdentityMissing", nil
	}
	if cleanInterfaceString(existing.ModelInfo["opensphere_spec_hash"]) != desiredHash {
		if err := s.updateRoute(ctx, existing.ID, modelName, params, modelInfo); err != nil {
			return "", "LiteLLMRouteUpdateFailed", nil
		}
	}
	return existing.ID, "", nil
}

func liteLLMModels(claim *unstructured.Unstructured) []string {
	models, _, _ := unstructured.NestedStringSlice(claim.Object, "spec", "parameters", "models")
	result := make([]string, 0, len(models))
	seen := map[string]bool{}
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model != "" && !seen[model] {
			seen[model] = true
			result = append(result, model)
		}
	}
	return result
}

func liteLLMRouteSpec(claim, credential *unstructured.Unstructured) (string, map[string]interface{}, map[string]interface{}, string) {
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	modelName := strings.TrimSpace(cleanInterfaceString(parameters["modelName"]))
	if modelName == "" {
		return "", nil, nil, "LiteLLMRouteModelNameRequired"
	}
	params, _ := parameters["litellmParams"].(map[string]interface{})
	if params == nil {
		params = map[string]interface{}{}
	} else {
		copyParams := map[string]interface{}{}
		for key, value := range params {
			copyParams[key] = value
		}
		params = copyParams
	}
	for _, forbidden := range []string{"api_key", "aws_access_key_id", "aws_secret_access_key", "token", "secret"} {
		if _, found := params[forbidden]; found {
			return "", nil, nil, "LiteLLMRouteSecretMustUseCredentialRef"
		}
	}
	providerModel := strings.TrimSpace(cleanInterfaceString(params["model"]))
	if providerModel == "" {
		providerModel = strings.TrimSpace(cleanInterfaceString(parameters["providerModel"]))
		if providerModel != "" {
			params["model"] = providerModel
		}
	}
	if providerModel == "" {
		return "", nil, nil, "LiteLLMProviderModelRequired"
	}
	credentialKeys := map[string]string{
		"api_key": "api_key", "api_base": "api_base", "api_version": "api_version",
		"aws_access_key_id": "aws_access_key_id", "aws_secret_access_key": "aws_secret_access_key",
		"aws_region_name": "aws_region_name", "vertex_project": "vertex_project", "vertex_location": "vertex_location",
	}
	credentialFound := false
	for secretKey, paramKey := range credentialKeys {
		if value := strings.TrimSpace(secretString(credential, secretKey)); value != "" {
			params[paramKey] = value
			if secretKey == "api_key" || secretKey == "aws_secret_access_key" {
				credentialFound = true
			}
		}
	}
	if !credentialFound && !strings.HasPrefix(providerModel, "ollama/") {
		return "", nil, nil, "LiteLLMProviderCredentialInvalid"
	}
	modelInfo, _ := parameters["modelInfo"].(map[string]interface{})
	if modelInfo == nil {
		modelInfo = map[string]interface{}{}
	} else {
		copyInfo := map[string]interface{}{}
		for key, value := range modelInfo {
			copyInfo[key] = value
		}
		modelInfo = copyInfo
	}
	fingerprintPayload, _ := json.Marshal(map[string]interface{}{"model_name": modelName, "litellm_params": params})
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(fingerprintPayload))
	modelInfo["opensphere_managed"] = true
	modelInfo["opensphere_claim_namespace"] = claim.GetNamespace()
	modelInfo["opensphere_claim_name"] = claim.GetName()
	modelInfo["opensphere_claim_uid"] = string(claim.GetUID())
	modelInfo["opensphere_spec_hash"] = fingerprint
	return modelName, params, modelInfo, ""
}

func (r *claimReconciler) liteLLMSession(ctx context.Context) (*liteLLMSession, string, error) {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: liteLLMName}, deployment); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "LiteLLMNotReady", nil
		}
		return nil, "", err
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	if desired < 1 || ready < desired {
		return nil, "LiteLLMNotReady", nil
	}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: aiRuntimeSecret}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "LiteLLMMasterCredentialNotReady", nil
		}
		return nil, "", err
	}
	masterKey := secretString(secret, "litellm-master-key")
	if !strings.HasPrefix(masterKey, "sk-") || len(masterKey) < 35 {
		return nil, "LiteLLMMasterCredentialInvalid", nil
	}
	baseURL := "http://" + liteLLMName + "." + r.cfg.managedNS + ".svc:4000"
	return &liteLLMSession{baseURL: baseURL, masterKey: masterKey, client: liteLLMHTTPClient}, "", nil
}

func liteLLMCredentialName(claim *unstructured.Unstructured) string {
	name := strings.ToLower(claim.GetName() + liteLLMCredentialSuffix)
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func (r *claimReconciler) storeLiteLLMCredential(ctx context.Context, claim *unstructured.Unstructured, endpoint, key, tokenID string, models []string) (*unstructured.Unstructured, error) {
	name := liteLLMCredentialName(claim)
	secret := object(coreSecretGVK, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]interface{}{
		"api_key": base64.StdEncoding.EncodeToString([]byte(key)), "base_url": base64.StdEncoding.EncodeToString([]byte(endpoint)),
		"models": base64.StdEncoding.EncodeToString([]byte(strings.Join(models, ","))), "token_id": base64.StdEncoding.EncodeToString([]byte(tokenID)),
	}
	secret.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-ai", lblModel: "ai", lblEngine: "litellm", "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, err
	}
	return secret, nil
}

func (r *claimReconciler) resolveLiteLLMServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	endpoint := "http://" + liteLLMName + "." + r.cfg.managedNS + ".svc:4000"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: liteLLMName + "." + r.cfg.managedNS + ".svc:4000", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": liteLLMName, "namespace": r.cfg.managedNS}}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	if requestTypeOf(claim) == "Route" {
		secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
		if !found || strings.TrimSpace(secretName) == "" {
			return serviceBindingProjection{}, "CredentialSecretRefRequired", nil
		}
		credential := gvkObj(coreSecretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, credential); err != nil {
			if apierrors.IsNotFound(err) {
				return serviceBindingProjection{}, "CredentialSecretNotReady", nil
			}
			return serviceBindingProjection{}, "", err
		}
		modelName, params, modelInfo, invalidReason := liteLLMRouteSpec(claim, credential)
		if invalidReason != "" {
			return serviceBindingProjection{}, invalidReason, nil
		}
		session, reason, err := r.liteLLMSession(ctx)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		modelID, reason, err := session.ensureRoute(ctx, claim, modelName, params, modelInfo)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "litellm.opensphere.io/v1", "kind": "ModelRoute", "name": modelName, "id": modelID}
		projection.Capabilities = append(projection.Capabilities, "model:"+modelName)
		return projection, "", nil
	}
	if requestTypeOf(claim) != "Access" {
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
	models := liteLLMModels(claim)
	if len(models) == 0 {
		return serviceBindingProjection{}, "LiteLLMModelsRequired", nil
	}
	session, reason, err := r.liteLLMSession(ctx)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	name := liteLLMCredentialName(claim)
	credential := gvkObj(coreSecretGVK)
	key := ""
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, credential); err == nil {
		key = secretString(credential, "api_key")
		if key == "" {
			return serviceBindingProjection{}, "LiteLLMCredentialInvalid", nil
		}
		exists, queryErr := session.keyExists(ctx, key)
		if queryErr != nil {
			return serviceBindingProjection{}, "LiteLLMKeyQueryFailed", nil
		}
		if !exists {
			key = ""
		}
	} else if !apierrors.IsNotFound(err) {
		return serviceBindingProjection{}, "", err
	}
	if key == "" {
		key, tokenID, generateErr := session.generateKey(ctx, claim, models)
		if generateErr != nil {
			return serviceBindingProjection{}, "LiteLLMKeyCreateFailed", nil
		}
		credential, err = r.storeLiteLLMCredential(ctx, claim, endpoint, key, tokenID, models)
		if err != nil {
			_ = session.deleteKey(ctx, key)
			return serviceBindingProjection{}, "", err
		}
	}
	projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
	projection.ResourceRef = map[string]interface{}{"apiVersion": "litellm.opensphere.io/v1", "kind": "VirtualKey", "name": claim.GetName(), "namespace": claim.GetNamespace()}
	projection.Capabilities = append(projection.Capabilities, "models:"+strings.Join(models, ","))
	return projection, "", nil
}

func (r *claimReconciler) cleanupLiteLLMServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) == "Route" {
		session, reason, err := r.liteLLMSession(ctx)
		if err != nil {
			return false, err
		}
		if reason != "" {
			return false, nil
		}
		routes, err := session.routes(ctx)
		if err != nil {
			return false, err
		}
		for _, route := range routes {
			if !routeOwnedByClaim(route, claim) {
				continue
			}
			if route.ID == "" {
				return false, fmt.Errorf("owned LiteLLM route %q omitted model id", route.ModelName)
			}
			if err := session.deleteRoute(ctx, route.ID); err != nil {
				return false, err
			}
			return false, nil
		}
		return true, nil
	}
	if requestTypeOf(claim) != "Access" {
		return true, nil
	}
	name := liteLLMCredentialName(claim)
	credential := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, credential); err != nil {
		return apierrors.IsNotFound(err), clientIgnoreNotFound(err)
	}
	session, reason, err := r.liteLLMSession(ctx)
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	key := secretString(credential, "api_key")
	if key != "" {
		if err := session.deleteKey(ctx, key); err != nil {
			return false, err
		}
	}
	if err := r.direct.Delete(ctx, credential); err != nil && !apierrors.IsNotFound(err) {
		return false, err
	}
	return false, nil
}
