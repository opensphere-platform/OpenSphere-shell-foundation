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

const mattermostAccessSuffix = "-mattermost-access"

var (
	mattermostHTTPClient = &http.Client{Timeout: 8 * time.Second}
	mattermostTeamName   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`)
	mattermostBotName    = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,21}$`)
)

type mattermostSession struct {
	baseURL string
	token   string
	client  *http.Client
}

func (s *mattermostSession) request(ctx context.Context, method, path string, payload interface{}) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.baseURL, "/")+"/api/v4"+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, response, err
}

func decodeObject(body []byte) map[string]interface{} {
	value := map[string]interface{}{}
	_ = json.Unmarshal(body, &value)
	return value
}

func mattermostParameters(claim *unstructured.Unstructured) map[string]interface{} {
	parameters, _, _ := unstructured.NestedMap(claim.Object, "spec", "parameters")
	return parameters
}

func mattermostString(values map[string]interface{}, key string) string {
	value, ok := values[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func mattermostMarkerName(claim *unstructured.Unstructured, suffix string) string {
	name := strings.ToLower(claim.GetName() + suffix)
	name = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(name, "-")
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func (r *claimReconciler) mattermostSession(ctx context.Context, claim *unstructured.Unstructured) (*mattermostSession, string, error) {
	deployment := gvkObj(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"})
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: r.cfg.managedNS, Name: mattermostName}, deployment); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, "MattermostNotReady", nil
		}
		return nil, "", err
	}
	desired, _, _ := unstructured.NestedInt64(deployment.Object, "spec", "replicas")
	ready, _, _ := unstructured.NestedInt64(deployment.Object, "status", "readyReplicas")
	if desired < 1 || ready < desired {
		return nil, "MattermostNotReady", nil
	}
	secretName, found, _ := unstructured.NestedString(claim.Object, "spec", "credentialSecretRef", "name")
	if !found || strings.TrimSpace(secretName) == "" {
		return nil, "MattermostAdminCredentialRequired", nil
	}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, secret); err != nil {
		return nil, "MattermostAdminCredentialNotReady", clientIgnoreNotFound(err)
	}
	token := secretString(secret, "token")
	if len(token) < 20 {
		return nil, "MattermostAdminCredentialInvalid", nil
	}
	baseURL := secretString(secret, "base_url")
	if baseURL == "" {
		baseURL = "http://" + mattermostName + "." + r.cfg.managedNS + ".svc:8065"
	}
	session := &mattermostSession{baseURL: baseURL, token: token, client: mattermostHTTPClient}
	status, _, err := session.request(ctx, http.MethodGet, "/users/me", nil)
	if err != nil {
		return nil, "MattermostAdminCredentialVerificationFailed", nil
	}
	if status != http.StatusOK {
		return nil, "MattermostAdminCredentialVerificationFailed", nil
	}
	return session, "", nil
}

func (s *mattermostSession) getTeam(ctx context.Context, name string) (map[string]interface{}, bool, error) {
	status, body, err := s.request(ctx, http.MethodGet, "/teams/name/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, false, err
	}
	if status == http.StatusNotFound {
		return nil, false, nil
	}
	if status != http.StatusOK {
		return nil, false, fmt.Errorf("Mattermost team query returned HTTP %d", status)
	}
	return decodeObject(body), true, nil
}

func (s *mattermostSession) createTeam(ctx context.Context, name, displayName, teamType string) (map[string]interface{}, error) {
	status, body, err := s.request(ctx, http.MethodPost, "/teams", map[string]interface{}{"name": name, "display_name": displayName, "type": teamType})
	if err != nil {
		return nil, err
	}
	if status != http.StatusCreated {
		return nil, fmt.Errorf("Mattermost team create returned HTTP %d", status)
	}
	return decodeObject(body), nil
}

func mattermostMarker(claim *unstructured.Unstructured, name string, data map[string]interface{}) *unstructured.Unstructured {
	marker := object(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, claim.GetNamespace(), name)
	marker.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-communication", lblModel: "communication", lblEngine: "mattermost", "foundation.opensphere.io/service-claim": claim.GetName()})
	stringData := map[string]interface{}{}
	for key, value := range data {
		stringData[key] = fmt.Sprint(value)
	}
	marker.Object["data"] = stringData
	_ = unstructured.SetNestedSlice(marker.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	return marker
}

func configMapString(value *unstructured.Unstructured, key string) string {
	text, _, _ := unstructured.NestedString(value.Object, "data", key)
	return strings.TrimSpace(text)
}

func (r *claimReconciler) ensureMattermostWorkspace(ctx context.Context, claim *unstructured.Unstructured, session *mattermostSession) (map[string]interface{}, string, error) {
	parameters := mattermostParameters(claim)
	name := strings.ToLower(mattermostString(parameters, "teamName"))
	displayName := mattermostString(parameters, "displayName")
	teamType := mattermostString(parameters, "teamType")
	if teamType == "" {
		teamType = "O"
	}
	if !mattermostTeamName.MatchString(name) || displayName == "" || (teamType != "O" && teamType != "I") {
		return nil, "InvalidMattermostWorkspace", nil
	}
	markerName := mattermostMarkerName(claim, "-mattermost-workspace")
	marker := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
	markerErr := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: markerName}, marker)
	team, exists, err := session.getTeam(ctx, name)
	if err != nil {
		return nil, "", err
	}
	if exists {
		if markerErr != nil || configMapString(marker, "team_id") != fmt.Sprint(team["id"]) {
			return nil, "MattermostWorkspaceOwnershipConflict", nil
		}
		return team, "", nil
	}
	if markerErr == nil {
		return nil, "MattermostWorkspaceDrift", nil
	}
	if !apierrors.IsNotFound(markerErr) {
		return nil, "", markerErr
	}
	team, err = session.createTeam(ctx, name, displayName, teamType)
	if err != nil {
		return nil, "MattermostWorkspaceCreateFailed", nil
	}
	teamID := strings.TrimSpace(fmt.Sprint(team["id"]))
	if teamID == "" || teamID == "<nil>" {
		return nil, "MattermostWorkspaceCreateFailed", nil
	}
	if err := applyObj(ctx, r.direct, mattermostMarker(claim, markerName, map[string]interface{}{"team_id": teamID, "team_name": name})); err != nil {
		_, _, _ = session.request(ctx, http.MethodDelete, "/teams/"+url.PathEscape(teamID), nil)
		return nil, "", err
	}
	return team, "", nil
}

func (s *mattermostSession) getBotByUsername(ctx context.Context, username string) (map[string]interface{}, bool, error) {
	status, body, err := s.request(ctx, http.MethodGet, "/users/username/"+url.PathEscape(username), nil)
	if err != nil {
		return nil, false, err
	}
	if status == http.StatusNotFound {
		return nil, false, nil
	}
	if status != http.StatusOK {
		return nil, false, fmt.Errorf("Mattermost bot query returned HTTP %d", status)
	}
	user := decodeObject(body)
	userID := strings.TrimSpace(fmt.Sprint(user["id"]))
	status, body, err = s.request(ctx, http.MethodGet, "/bots/"+url.PathEscape(userID), nil)
	if err != nil {
		return nil, false, err
	}
	if status == http.StatusNotFound {
		return nil, false, nil
	}
	if status != http.StatusOK {
		return nil, false, fmt.Errorf("Mattermost bot query returned HTTP %d", status)
	}
	return decodeObject(body), true, nil
}

func (s *mattermostSession) createBot(ctx context.Context, username, displayName, description string) (map[string]interface{}, error) {
	status, body, err := s.request(ctx, http.MethodPost, "/bots", map[string]interface{}{"username": username, "display_name": displayName, "description": description})
	if err != nil {
		return nil, err
	}
	if status != http.StatusCreated {
		return nil, fmt.Errorf("Mattermost bot create returned HTTP %d", status)
	}
	return decodeObject(body), nil
}

func (s *mattermostSession) createBotToken(ctx context.Context, userID, description string) (string, string, error) {
	status, body, err := s.request(ctx, http.MethodPost, "/users/"+url.PathEscape(userID)+"/tokens", map[string]interface{}{"description": description})
	if err != nil {
		return "", "", err
	}
	if status != http.StatusCreated {
		return "", "", fmt.Errorf("Mattermost bot token create returned HTTP %d", status)
	}
	value := decodeObject(body)
	return strings.TrimSpace(fmt.Sprint(value["token"])), strings.TrimSpace(fmt.Sprint(value["id"])), nil
}

func (s *mattermostSession) ensureTeamMember(ctx context.Context, teamID, userID string) error {
	path := "/teams/" + url.PathEscape(teamID) + "/members/" + url.PathEscape(userID)
	status, _, err := s.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		return nil
	}
	if status != http.StatusNotFound {
		return fmt.Errorf("Mattermost team membership query returned HTTP %d", status)
	}
	status, _, err = s.request(ctx, http.MethodPost, "/teams/"+url.PathEscape(teamID)+"/members", map[string]interface{}{"team_id": teamID, "user_id": userID})
	if err != nil {
		return err
	}
	if status != http.StatusCreated {
		return fmt.Errorf("Mattermost team membership create returned HTTP %d", status)
	}
	return nil
}

func (r *claimReconciler) ensureMattermostAccess(ctx context.Context, claim *unstructured.Unstructured, session *mattermostSession) (*unstructured.Unstructured, string, error) {
	parameters := mattermostParameters(claim)
	username := strings.ToLower(mattermostString(parameters, "botUsername"))
	displayName := mattermostString(parameters, "displayName")
	description := mattermostString(parameters, "description")
	if !mattermostBotName.MatchString(username) {
		return nil, "InvalidMattermostBot", nil
	}
	target := targetRefOf(claim)
	teamName := strings.ToLower(strings.TrimSpace(fmt.Sprint(target["name"])))
	if !mattermostTeamName.MatchString(teamName) {
		return nil, "MattermostWorkspaceTargetRequired", nil
	}
	team, teamExists, err := session.getTeam(ctx, teamName)
	if err != nil {
		return nil, "", err
	}
	if !teamExists {
		return nil, "MattermostWorkspaceNotReady", nil
	}
	teamID := strings.TrimSpace(fmt.Sprint(team["id"]))
	secretName := mattermostMarkerName(claim, mattermostAccessSuffix)
	credential := gvkObj(coreSecretGVK)
	credentialErr := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: secretName}, credential)
	bot, exists, err := session.getBotByUsername(ctx, username)
	if err != nil {
		return nil, "", err
	}
	if exists && credentialErr != nil {
		return nil, "MattermostBotOwnershipConflict", nil
	}
	if credentialErr == nil {
		if !exists || secretString(credential, "user_id") != fmt.Sprint(bot["user_id"]) {
			return nil, "MattermostBotDrift", nil
		}
		if err := session.ensureTeamMember(ctx, teamID, secretString(credential, "user_id")); err != nil {
			return nil, "MattermostTeamMembershipFailed", nil
		}
		return credential, "", nil
	}
	if !apierrors.IsNotFound(credentialErr) {
		return nil, "", credentialErr
	}
	bot, err = session.createBot(ctx, username, displayName, description)
	if err != nil {
		return nil, "MattermostBotCreateFailed", nil
	}
	userID := strings.TrimSpace(fmt.Sprint(bot["user_id"]))
	if userID == "" || userID == "<nil>" {
		return nil, "MattermostBotCreateFailed", nil
	}
	if err := session.ensureTeamMember(ctx, teamID, userID); err != nil {
		return nil, "MattermostTeamMembershipFailed", nil
	}
	token, tokenID, err := session.createBotToken(ctx, userID, "OpenSphere FoundationClaim "+claim.GetNamespace()+"/"+claim.GetName())
	if err != nil || token == "" || tokenID == "" || token == "<nil>" || tokenID == "<nil>" {
		return nil, "MattermostBotTokenCreateFailed", nil
	}
	credential = object(coreSecretGVK, claim.GetNamespace(), secretName)
	credential.Object["type"] = "Opaque"
	credential.Object["data"] = map[string]interface{}{
		"token": base64.StdEncoding.EncodeToString([]byte(token)), "token_id": base64.StdEncoding.EncodeToString([]byte(tokenID)), "user_id": base64.StdEncoding.EncodeToString([]byte(userID)),
		"base_url": base64.StdEncoding.EncodeToString([]byte(session.baseURL)), "username": base64.StdEncoding.EncodeToString([]byte(username)), "team_id": base64.StdEncoding.EncodeToString([]byte(teamID)),
	}
	credential.SetLabels(map[string]string{lblManagedBy: cpManagedBy, lblPartOf: "foundation-communication", lblModel: "communication", lblEngine: "mattermost", "foundation.opensphere.io/service-claim": claim.GetName()})
	_ = unstructured.SetNestedSlice(credential.Object, []interface{}{unstructuredOwnerReference(claim)}, "metadata", "ownerReferences")
	if err := applyObj(ctx, r.direct, credential); err != nil {
		_, _, _ = session.request(ctx, http.MethodDelete, "/users/tokens/"+url.PathEscape(tokenID), nil)
		return nil, "", err
	}
	return credential, "", nil
}

func (r *claimReconciler) resolveMattermostServiceBinding(ctx context.Context, claim *unstructured.Unstructured, contract serviceModuleContract) (serviceBindingProjection, string, error) {
	managed, err := r.foundationServiceNamespaceAccepted(ctx, claim.GetNamespace())
	if err != nil {
		return serviceBindingProjection{}, "", err
	}
	if !managed {
		return serviceBindingProjection{}, "NamespaceNotManaged", nil
	}
	endpoint := "http://" + mattermostName + "." + r.cfg.managedNS + ".svc:8065"
	projection := serviceBindingProjection{Module: contract.ID, Endpoint: endpoint, Probe: mattermostName + "." + r.cfg.managedNS + ".svc:8065", Capabilities: append([]string(nil), contract.Capabilities...), ResourceRef: map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": mattermostName, "namespace": r.cfg.managedNS}}
	if requestTypeOf(claim) == "Instance" {
		return projection, "", nil
	}
	session, reason, err := r.mattermostSession(ctx, claim)
	if err != nil || reason != "" {
		return serviceBindingProjection{}, reason, err
	}
	switch requestTypeOf(claim) {
	case "Workspace":
		team, reason, err := r.ensureMattermostWorkspace(ctx, claim, session)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "mattermost.opensphere.io/v1", "kind": "Team", "name": fmt.Sprint(team["name"]), "namespace": claim.GetNamespace()}
		return projection, "", nil
	case "Access":
		credential, reason, err := r.ensureMattermostAccess(ctx, claim, session)
		if err != nil || reason != "" {
			return serviceBindingProjection{}, reason, err
		}
		projection.SecretRef = map[string]interface{}{"name": credential.GetName(), "namespace": credential.GetNamespace()}
		projection.ResourceRef = map[string]interface{}{"apiVersion": "mattermost.opensphere.io/v1", "kind": "BotAccess", "name": mattermostString(mattermostParameters(claim), "botUsername"), "namespace": claim.GetNamespace()}
		return projection, "", nil
	default:
		return serviceBindingProjection{}, "UnsupportedRequestType", nil
	}
}

func (r *claimReconciler) cleanupMattermostServiceClaim(ctx context.Context, claim *unstructured.Unstructured) (bool, error) {
	if requestTypeOf(claim) == "Instance" {
		return true, nil
	}
	session, reason, err := r.mattermostSession(ctx, claim)
	if err != nil {
		return false, err
	}
	if reason != "" {
		return false, nil
	}
	if requestTypeOf(claim) == "Workspace" {
		markerName := mattermostMarkerName(claim, "-mattermost-workspace")
		marker := gvkObj(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: markerName}, marker); err != nil {
			return apierrors.IsNotFound(err), clientIgnoreNotFound(err)
		}
		teamID := configMapString(marker, "team_id")
		status, _, requestErr := session.request(ctx, http.MethodDelete, "/teams/"+url.PathEscape(teamID), nil)
		if requestErr != nil || (status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound) {
			return false, requestErr
		}
		if err := r.direct.Delete(ctx, marker); err != nil && !apierrors.IsNotFound(err) {
			return false, err
		}
		return false, nil
	}
	credential := gvkObj(coreSecretGVK)
	name := mattermostMarkerName(claim, mattermostAccessSuffix)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: claim.GetNamespace(), Name: name}, credential); err != nil {
		return apierrors.IsNotFound(err), clientIgnoreNotFound(err)
	}
	tokenID := secretString(credential, "token_id")
	if tokenID != "" {
		status, _, requestErr := session.request(ctx, http.MethodDelete, "/users/tokens/"+url.PathEscape(tokenID), nil)
		if requestErr != nil || (status != http.StatusOK && status != http.StatusNoContent && status != http.StatusNotFound) {
			return false, requestErr
		}
	}
	if err := r.direct.Delete(ctx, credential); err != nil && !apierrors.IsNotFound(err) {
		return false, err
	}
	return false, nil
}
