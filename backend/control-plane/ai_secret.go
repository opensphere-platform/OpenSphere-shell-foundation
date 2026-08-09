package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func (r *modelReconciler) ensureAIRuntimeSecret(ctx context.Context, fm *unstructured.Unstructured, namespace string) error {
	// Both engines are disabled by default; no secret is required until an AI
	// runtime is explicitly selected.
	if !engineEnabled(fm, "litellm") && !engineEnabled(fm, "langfuse") {
		return nil
	}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: aiRuntimeSecret}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("required exact Secret %s/%s is missing; run Initialize-AIRuntimeSecrets.ps1", namespace, aiRuntimeSecret)
		}
		return err
	}
	if engineEnabled(fm, "litellm") {
		key := secretString(secret, "litellm-master-key")
		if !strings.HasPrefix(key, "sk-") || len(key) < 35 {
			return fmt.Errorf("Secret %s/%s has an invalid litellm-master-key", namespace, aiRuntimeSecret)
		}
	}
	if engineEnabled(fm, "langfuse") {
		for _, key := range []string{"langfuse-nextauth-secret", "langfuse-salt", "clickhouse-password"} {
			if len(secretString(secret, key)) < 32 {
				return fmt.Errorf("Secret %s/%s data.%s must contain at least 32 bytes", namespace, aiRuntimeSecret, key)
			}
		}
		encryption := secretString(secret, "langfuse-encryption-key")
		decoded, err := hex.DecodeString(encryption)
		if err != nil || len(decoded) != 32 {
			return fmt.Errorf("Secret %s/%s data.langfuse-encryption-key must be 32-byte hexadecimal", namespace, aiRuntimeSecret)
		}
		for _, key := range []string{"langfuse-init-org-id", "langfuse-init-org-name", "langfuse-init-project-id", "langfuse-init-project-name"} {
			if strings.TrimSpace(secretString(secret, key)) == "" {
				return fmt.Errorf("Secret %s/%s data.%s must not be empty", namespace, aiRuntimeSecret, key)
			}
		}
		if value := secretString(secret, "langfuse-init-project-public-key"); !strings.HasPrefix(value, "lf_pk_") || len(value) < 30 {
			return fmt.Errorf("Secret %s/%s has an invalid Langfuse project public key", namespace, aiRuntimeSecret)
		}
		if value := secretString(secret, "langfuse-init-project-secret-key"); !strings.HasPrefix(value, "lf_sk_") || len(value) < 30 {
			return fmt.Errorf("Secret %s/%s has an invalid Langfuse project secret key", namespace, aiRuntimeSecret)
		}
	}
	return nil
}
