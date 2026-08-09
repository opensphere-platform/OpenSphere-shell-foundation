package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

var openSearchAdminHashPattern = regexp.MustCompile(`(?m)^\s*hash:\s*["']?([^"'\s]+)`)

// ensureOpenSearchAdminCredential creates the one platform credential consumed
// by the upstream OpenSearch Operator. It is never projected to a consumer;
// consumer Access claims receive their own OpensearchUser and password.
func (r *modelReconciler) ensureOpenSearchAdminCredential(ctx context.Context, fm *unstructured.Unstructured, namespace string) error {
	if fm.GetName() != "data" || !engineEnabled(fm, "opensearch") {
		return nil
	}
	secret := gvkObj(coreSecretGVK)
	nn := types.NamespacedName{Namespace: namespace, Name: openSearchAdminSecretName}
	err := r.direct.Get(ctx, nn, secret)
	if apierrors.IsNotFound(err) {
		password, generateErr := randomServicePassword(40)
		if generateErr != nil {
			return generateErr
		}
		secret = object(coreSecretGVK, namespace, openSearchAdminSecretName)
		secret.Object["type"] = "Opaque"
		secret.Object["data"] = map[string]interface{}{
			"username": base64.StdEncoding.EncodeToString([]byte("admin")),
			"password": base64.StdEncoding.EncodeToString([]byte(password)),
		}
		stampLabels(secret, "data", fm.GetName())
		markEngine(secret, "opensearch")
		if err := applyObj(ctx, r.direct, secret); err != nil {
			return err
		}
		if err := r.direct.Get(ctx, nn, secret); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	password := secretString(secret, "password")
	if strings.TrimSpace(secretString(secret, "username")) != "admin" || len(password) < 24 {
		return fmt.Errorf("OpenSearch operator admin Secret %s/%s is invalid", namespace, openSearchAdminSecretName)
	}
	return r.ensureOpenSearchSecurityConfig(ctx, fm, namespace, password)
}

func (r *modelReconciler) ensureOpenSearchSecurityConfig(ctx context.Context, fm *unstructured.Unstructured, namespace, password string) error {
	secret := gvkObj(coreSecretGVK)
	nn := types.NamespacedName{Namespace: namespace, Name: openSearchSecurityConfigSecretName}
	err := r.direct.Get(ctx, nn, secret)
	if err == nil {
		users := secretString(secret, "internal_users.yml")
		match := openSearchAdminHashPattern.FindStringSubmatch(users)
		if len(match) != 2 || bcrypt.CompareHashAndPassword([]byte(match[1]), []byte(password)) != nil {
			return fmt.Errorf("OpenSearch security config Secret %s/%s does not match the platform admin credential", namespace, openSearchSecurityConfigSecretName)
		}
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	secret = object(coreSecretGVK, namespace, openSearchSecurityConfigSecretName)
	secret.Object["type"] = "Opaque"
	data := map[string]interface{}{}
	for key, value := range openSearchSecurityDocuments(string(hash)) {
		data[key] = base64.StdEncoding.EncodeToString([]byte(value))
	}
	secret.Object["data"] = data
	stampLabels(secret, "data", fm.GetName())
	markEngine(secret, "opensearch")
	return applyObj(ctx, r.direct, secret)
}

func openSearchSecurityDocuments(adminHash string) map[string]string {
	return map[string]string{
		"action_groups.yml": `_meta:
  type: "actiongroups"
  config_version: 2
`,
		"internal_users.yml": fmt.Sprintf(`_meta:
  type: "internalusers"
  config_version: 2
admin:
  hash: %q
  reserved: true
  backend_roles:
    - "admin"
  description: "OpenSphere platform administrator"
`, adminHash),
		"nodes_dn.yml": `_meta:
  type: "nodesdn"
  config_version: 2
`,
		"whitelist.yml": `_meta:
  type: "whitelist"
  config_version: 2
`,
		"tenants.yml": `_meta:
  type: "tenants"
  config_version: 2
`,
		"roles_mapping.yml": `_meta:
  type: "rolesmapping"
  config_version: 2
all_access:
  reserved: false
  backend_roles:
    - "admin"
`,
		"roles.yml": `_meta:
  type: "roles"
  config_version: 2
all_access:
  reserved: true
  cluster_permissions:
    - "*"
  index_permissions:
    - index_patterns:
        - "*"
      allowed_actions:
        - "*"
  tenant_permissions:
    - tenant_patterns:
        - "*"
      allowed_actions:
        - "kibana_all_write"
`,
		"config.yml": `_meta:
  type: "config"
  config_version: 2
config:
  dynamic:
    http:
      anonymous_auth_enabled: false
    authc:
      basic_internal_auth_domain:
        description: "Authenticate against the internal user database"
        http_enabled: true
        transport_enabled: true
        order: 0
        http_authenticator:
          type: basic
          challenge: true
        authentication_backend:
          type: intern
`,
	}
}
