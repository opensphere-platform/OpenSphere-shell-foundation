package main

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func (r *modelReconciler) ensureCommunicationRuntimeSecret(ctx context.Context, fm *unstructured.Unstructured, namespace string) error {
	if !engineEnabled(fm, "stalwart") && !engineEnabled(fm, "novu") {
		return nil
	}
	secret := gvkObj(coreSecretGVK)
	if err := r.direct.Get(ctx, types.NamespacedName{Namespace: namespace, Name: communicationRuntimeSecret}, secret); err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("required exact Secret %s/%s is missing; run Initialize-CommunicationRuntimeSecrets.ps1", namespace, communicationRuntimeSecret)
		}
		return err
	}
	if engineEnabled(fm, "stalwart") {
		parts := strings.SplitN(secretString(secret, "stalwart-recovery-admin"), ":", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || len(parts[1]) < 24 {
			return fmt.Errorf("Secret %s/%s has an invalid stalwart-recovery-admin", namespace, communicationRuntimeSecret)
		}
		if secretString(secret, "stalwart-admin-user") != parts[0] || secretString(secret, "stalwart-admin-password") != parts[1] {
			return fmt.Errorf("Secret %s/%s Stalwart automation credential does not match the recovery bootstrap credential", namespace, communicationRuntimeSecret)
		}
	}
	if engineEnabled(fm, "novu") {
		for _, key := range []string{"novu-jwt-secret", "novu-secret-key"} {
			if len(secretString(secret, key)) < 32 {
				return fmt.Errorf("Secret %s/%s data.%s must contain at least 32 characters", namespace, communicationRuntimeSecret, key)
			}
		}
		if len(secretString(secret, "novu-encryption-key")) != 32 {
			return fmt.Errorf("Secret %s/%s data.novu-encryption-key must contain exactly 32 characters", namespace, communicationRuntimeSecret)
		}
	}
	return nil
}
