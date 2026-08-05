package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const valkeyDefaultAuthSecret = "foundation-data-valkey-auth"

var coreSecretGVK = schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Secret"}

// ensureValkeyCredential owns only the bootstrap boundary. It creates the exact
// default Secret once when Valkey is enabled, never rotates an existing value,
// and never creates an arbitrary user-provided Secret name.
func (r *modelReconciler) ensureValkeyCredential(ctx context.Context, fm *unstructured.Unstructured, ns string) error {
	model, _, _ := unstructured.NestedString(fm.Object, "spec", "model")
	if model != "data" || !engineEnabled(fm, "valkey") {
		return nil
	}

	opts := dataEngineParams(fm, r.cfg, "valkey")
	if opts.authSecret == "" {
		return fmt.Errorf("authSecret is required")
	}

	secret := gvkObj(coreSecretGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: opts.authSecret}, secret)
	if err == nil {
		password, found, nestedErr := unstructured.NestedString(secret.Object, "data", "password")
		if nestedErr != nil || !found || password == "" {
			return fmt.Errorf("Secret %s/%s exists but data.password is missing", ns, opts.authSecret)
		}
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return fmt.Errorf("read Secret %s/%s: %w", ns, opts.authSecret, err)
	}
	if opts.authSecret != valkeyDefaultAuthSecret {
		return fmt.Errorf("custom authSecret %s/%s does not exist; create it through an approved credential workflow", ns, opts.authSecret)
	}

	password, err := newValkeyPassword()
	if err != nil {
		return err
	}
	secret = &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]interface{}{
			"name":      valkeyDefaultAuthSecret,
			"namespace": ns,
		},
		"type": "Opaque",
		"data": map[string]interface{}{
			"password": base64.StdEncoding.EncodeToString([]byte(password)),
		},
	}}
	stampLabels(secret, "data", fm.GetName())
	labels := secret.GetLabels()
	labels[lblEngine] = "valkey"
	secret.SetLabels(labels)
	if err := applyObj(ctx, r.direct, secret); err != nil {
		return fmt.Errorf("bootstrap exact Secret %s/%s: %w", ns, valkeyDefaultAuthSecret, err)
	}
	return nil
}

func newValkeyPassword() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate Valkey password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
