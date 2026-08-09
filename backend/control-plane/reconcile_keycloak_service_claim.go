package main

import (
	"bytes"
	"context"
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
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const (
	keycloakAdminSecretName  = "foundation-identity-keycloak-admin"
	keycloakCredentialSuffix = "-keycloak-client"
)

var (
	keycloakNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`)
	keycloakHTTPClient  = &http.Client{Timeout: 8 * time.Second}
)

type keycloakAdminSession struct {
	baseURL string
	token   string
	client  *http.Client
}

func (r *claimReconciler) resolveKeycloakServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	if !r.keycloakReady(ctx) {
		return serviceBindingProjection{}, "KeycloakNotReady", nil
	}
	baseURL := "http://" + keycloakSvcDNS(r.cfg.managedNS) + ":8080"
	projection := serviceBindingProjection{
		Module: contract.ID, Endpoint: baseURL, Probe: keycloakSvcDNS(r.cfg.managedNS) + ":8080",
		Capabilities: append([]string(nil), contract.Capabilities...),
		ResourceRef:  map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": keycloakName, "namespace": r.cfg.managedNS},
	}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	session, reason, err := r.keycloakAdmin(ctx, baseURL)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	switch requestTypeOf(claim) {
	case "Realm":
		realm := serviceClaimString(claim, claim.GetName(), "realm")
		if !keycloakNamePattern.MatchString(realm) || realm == "master" {
			return serviceBindingProjection{}, "InvalidRequest", nil
		}
		payload := map[string]interface{}{
			"realm": realm, "displayName": serviceClaimString(claim, realm, "displayName"), "enabled": true,
			"registrationAllowed": false, "resetPasswordAllowed": true, "rememberMe": true,
			"loginWithEmailAllowed": true, "duplicateEmailsAllowed": false, "verifyEmail": true,
		}
		if err := session.ensureRealm(ctx, realm, payload); err != nil {
			return serviceBindingProjection{}, "KeycloakRealmReconcileFailed", nil
		}
		projection.Endpoint = baseURL + "/realms/" + url.PathEscape(realm)
		projection.ResourceRef = keycloakResourceRef("Realm", realm, realm)
		return projection, "", nil
	case "Client", "Access":
		realm := keycloakClaimTargetRealm(claim)
		clientID := serviceClaimString(claim, claim.GetName(), "clientId")
		if !keycloakNamePattern.MatchString(realm) || realm == "master" || !keycloakNamePattern.MatchString(clientID) {
			return serviceBindingProjection{}, "InvalidRequest", nil
		}
		internalID, found, err := session.findClient(ctx, realm, clientID)
		if err != nil {
			return serviceBindingProjection{}, "KeycloakClientQueryFailed", nil
		}
		if requestTypeOf(claim) == "Client" {
			internalID, err = session.ensureClient(ctx, realm, internalID, found, keycloakClientPayload(claim, clientID))
			if err != nil {
				return serviceBindingProjection{}, "KeycloakClientReconcileFailed", nil
			}
		} else if !found {
			return serviceBindingProjection{}, "KeycloakClientNotReady", nil
		}
		secretValue, err := session.clientSecret(ctx, realm, internalID)
		if err != nil || secretValue == "" {
			return serviceBindingProjection{}, "KeycloakClientSecretNotReady", nil
		}
		credential, err := r.ensureKeycloakClientCredential(ctx, claim, realm, clientID, secretValue, baseURL)
		if err != nil {
			return serviceBindingProjection{}, "", err
		}
		projection.Endpoint = baseURL + "/realms/" + url.PathEscape(realm)
		projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
		projection.ResourceRef = keycloakResourceRef("Client", clientID, realm)
		projection.Capabilities = append(projection.Capabilities, "realm:"+realm, "client:"+clientID)
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func (r *claimReconciler) keycloakReady(ctx context.Context) bool {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: keycloakName}, deployment); err != nil {
		return false
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	return desired > 0 && ready >= desired
}

func keycloakClaimTargetRealm(claim *unstructured.Unstructured) string {
	if realm := serviceClaimString(claim, "", "realm"); realm != "" {
		return realm
	}
	if target := targetRefOf(claim); target != nil {
		if name, ok := target["name"].(string); ok {
			return strings.TrimSpace(name)
		}
	}
	return workforceRealm
}

func keycloakClientPayload(claim *unstructured.Unstructured, clientID string) map[string]interface{} {
	redirects, _, _ := unstructured.NestedStringSlice(claim.Object, "spec", "parameters", "redirectUris")
	webOrigins, _, _ := unstructured.NestedStringSlice(claim.Object, "spec", "parameters", "webOrigins")
	publicClient, _, _ := unstructured.NestedBool(claim.Object, "spec", "parameters", "publicClient")
	return map[string]interface{}{
		"clientId": clientID, "name": serviceClaimString(claim, clientID, "displayName"), "enabled": true,
		"protocol": "openid-connect", "publicClient": publicClient, "redirectUris": redirects, "webOrigins": webOrigins,
		"standardFlowEnabled": len(redirects) > 0, "directAccessGrantsEnabled": false, "serviceAccountsEnabled": !publicClient,
		"attributes": map[string]string{"pkce.code.challenge.method": "S256"},
	}
}

func keycloakResourceRef(kind, name, realm string) map[string]interface{} {
	return map[string]interface{}{"apiVersion": "keycloak.org/admin-v1", "kind": kind, "name": name, "namespace": realm}
}

func (r *claimReconciler) keycloakAdmin(ctx context.Context, baseURL string) (*keycloakAdminSession, string, error) {
	secret := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: keycloakAdminSecretName}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "KeycloakAdminCredentialNotReady", nil
		}
		return nil, "", err
	}
	username, password := secretString(secret, "username"), secretString(secret, "password")
	if username == "" || password == "" {
		return nil, "KeycloakAdminCredentialInvalid", nil
	}
	form := url.Values{"grant_type": {"password"}, "client_id": {"admin-cli"}, "username": {username}, "password": {password}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/realms/master/protocol/openid-connect/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := keycloakHTTPClient.Do(req)
	if err != nil {
		return nil, "KeycloakAdminUnavailable", nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, "KeycloakAdminAuthenticationFailed", nil
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(body, &token) != nil || token.AccessToken == "" {
		return nil, "KeycloakAdminAuthenticationFailed", nil
	}
	return &keycloakAdminSession{baseURL: strings.TrimRight(baseURL, "/"), token: token.AccessToken, client: keycloakHTTPClient}, "", nil
}

func (s *keycloakAdminSession) request(ctx context.Context, method, path string, payload interface{}) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("authorization", "Bearer "+s.token)
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

func (s *keycloakAdminSession) ensureRealm(ctx context.Context, realm string, payload map[string]interface{}) error {
	path := "/admin/realms/" + url.PathEscape(realm)
	status, _, err := s.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		status, _, err = s.request(ctx, http.MethodPost, "/admin/realms", payload)
		if err != nil {
			return err
		}
		if status != http.StatusCreated && status != http.StatusNoContent {
			return fmt.Errorf("create realm returned HTTP %d", status)
		}
		return nil
	}
	if status != http.StatusOK {
		return fmt.Errorf("read realm returned HTTP %d", status)
	}
	status, _, err = s.request(ctx, http.MethodPut, path, payload)
	if err != nil {
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("update realm returned HTTP %d", status)
	}
	return nil
}

func (s *keycloakAdminSession) findClient(ctx context.Context, realm, clientID string) (string, bool, error) {
	path := "/admin/realms/" + url.PathEscape(realm) + "/clients?clientId=" + url.QueryEscape(clientID)
	status, body, err := s.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", false, err
	}
	if status != http.StatusOK {
		return "", false, fmt.Errorf("query client returned HTTP %d", status)
	}
	var clients []struct {
		ID       string `json:"id"`
		ClientID string `json:"clientId"`
	}
	if err := json.Unmarshal(body, &clients); err != nil {
		return "", false, err
	}
	for _, item := range clients {
		if item.ClientID == clientID && item.ID != "" {
			return item.ID, true, nil
		}
	}
	return "", false, nil
}

func (s *keycloakAdminSession) ensureClient(ctx context.Context, realm, internalID string, found bool, payload map[string]interface{}) (string, error) {
	base := "/admin/realms/" + url.PathEscape(realm) + "/clients"
	if !found {
		status, _, err := s.request(ctx, http.MethodPost, base, payload)
		if err != nil {
			return "", err
		}
		if status != http.StatusCreated && status != http.StatusNoContent {
			return "", fmt.Errorf("create client returned HTTP %d", status)
		}
		id, observed, err := s.findClient(ctx, realm, payload["clientId"].(string))
		if err != nil || !observed {
			return "", fmt.Errorf("created client cannot be observed: %w", err)
		}
		return id, nil
	}
	status, _, err := s.request(ctx, http.MethodPut, base+"/"+url.PathEscape(internalID), payload)
	if err != nil {
		return "", err
	}
	if status != http.StatusNoContent {
		return "", fmt.Errorf("update client returned HTTP %d", status)
	}
	return internalID, nil
}

func (s *keycloakAdminSession) clientSecret(ctx context.Context, realm, internalID string) (string, error) {
	path := "/admin/realms/" + url.PathEscape(realm) + "/clients/" + url.PathEscape(internalID) + "/client-secret"
	status, body, err := s.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("read client secret returned HTTP %d", status)
	}
	var payload struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	return payload.Value, nil
}

func (r *claimReconciler) ensureKeycloakClientCredential(ctx context.Context, claim *unstructured.Unstructured, realm, clientID, clientSecret, baseURL string) (*unstructured.Unstructured, error) {
	name, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if !supplied || strings.TrimSpace(name) == "" {
		name = claim.GetName() + keycloakCredentialSuffix
	}
	secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), name)
	secret.Object["type"] = "Opaque"
	issuer := strings.TrimRight(baseURL, "/") + "/realms/" + realm
	secret.Object["data"] = map[string]interface{}{
		"client-id":     base64.StdEncoding.EncodeToString([]byte(clientID)),
		"client-secret": base64.StdEncoding.EncodeToString([]byte(clientSecret)),
		"issuer":        base64.StdEncoding.EncodeToString([]byte(issuer)),
		"token-uri":     base64.StdEncoding.EncodeToString([]byte(issuer + "/protocol/openid-connect/token")),
	}
	secret.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-identity", lblModel: "identity", lblEngine: "keycloak", "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(secret.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return nil, err
	}
	return secret, nil
}

func (r *claimReconciler) cleanupKeycloakServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	requestType := requestTypeOf(claim)
	if requestType == "Client" || requestType == "Access" {
		if _, supplied, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name"); !supplied {
			secret := object(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, claim.GetNamespace(), claim.GetName()+keycloakCredentialSuffix)
			if err := r.direct.Delete(ctx, secret); err != nil && !apierrors.IsNotFound(err) {
				return false, err
			}
		}
	}
	if requestType == "Access" || serviceClaimString(claim, "Retain", "deletionPolicy") != "Delete" {
		return true, nil
	}
	session, reason, err := r.keycloakAdmin(ctx, "http://"+keycloakSvcDNS(r.cfg.managedNS)+":8080")
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	var path string
	if requestType == "Realm" {
		path = "/admin/realms/" + url.PathEscape(serviceClaimString(claim, claim.GetName(), "realm"))
	} else if requestType == "Client" {
		realm, clientID := keycloakClaimTargetRealm(claim), serviceClaimString(claim, claim.GetName(), "clientId")
		internalID, found, err := session.findClient(ctx, realm, clientID)
		if err != nil {
			return false, err
		}
		if !found {
			return true, nil
		}
		path = "/admin/realms/" + url.PathEscape(realm) + "/clients/" + url.PathEscape(internalID)
	} else {
		return true, nil
	}
	status, _, err := session.request(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return false, err
	}
	return status == http.StatusNoContent || status == http.StatusNotFound, nil
}
