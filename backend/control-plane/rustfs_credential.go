package main

import (
	"context"
	"encoding/base64"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

const rustfsDefaultAuthSecret = "rustfs-credentials"

// ensureRustFSCredential validates the installer-owned exact Secret and returns
// its resourceVersion. It never creates, rotates, or accepts an arbitrary Secret.
func (r *modelReconciler) ensureRustFSCredential(ctx context.Context, fm *unstructured.Unstructured, ns string) (string, error) {
	model, _, _ := unstructured.NestedString(fm.Object, "spec", "model")
	if model != "data" || !engineEnabled(fm, "rustfs") {
		return "", nil
	}

	opts := dataEngineParams(fm, r.cfg, "rustfs")
	if opts.authSecret != rustfsDefaultAuthSecret {
		return "", fmt.Errorf("authSecret must be the platform-owned exact Secret %q", rustfsDefaultAuthSecret)
	}

	secret := gvkObj(coreSecretGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: opts.authSecret}, secret)
	if err == nil {
		values := map[string]string{}
		for _, key := range []string{"access_key", "secret_key", "rpc_secret"} {
			value, found, nestedErr := unstructured.NestedString(secret.Object, "data", key)
			if nestedErr != nil || !found || value == "" {
				return "", fmt.Errorf("Secret %s/%s exists but data.%s is missing", ns, opts.authSecret, key)
			}
			decoded, decodeErr := base64.StdEncoding.DecodeString(value)
			if decodeErr != nil || len(decoded) < 24 {
				return "", fmt.Errorf("Secret %s/%s data.%s must be a base64-encoded value of at least 24 bytes", ns, opts.authSecret, key)
			}
			values[key] = string(decoded)
		}
		if values["secret_key"] == values["rpc_secret"] {
			return "", fmt.Errorf("Secret %s/%s must use distinct secret_key and rpc_secret values", ns, opts.authSecret)
		}
		return secret.GetResourceVersion(), nil
	}
	if !apierrors.IsNotFound(err) {
		return "", fmt.Errorf("read Secret %s/%s: %w", ns, opts.authSecret, err)
	}
	return "", fmt.Errorf("required exact Secret %s/%s is missing; run the platform credential bootstrap", ns, rustfsDefaultAuthSecret)
}

func stampRustFSCredentialRevision(objs []*unstructured.Unstructured, resourceVersion string) error {
	if resourceVersion == "" {
		return nil
	}
	for _, obj := range objs {
		if obj.GetKind() != "StatefulSet" || obj.GetName() != rustfsName {
			continue
		}
		annotations, _, err := unstructured.NestedStringMap(obj.Object, "spec", "template", "metadata", "annotations")
		if err != nil {
			return fmt.Errorf("read RustFS Pod template annotations: %w", err)
		}
		if annotations == nil {
			annotations = map[string]string{}
		}
		annotations["foundation.opensphere.io/rustfs-credential-resource-version"] = resourceVersion
		if err := unstructured.SetNestedStringMap(obj.Object, annotations, "spec", "template", "metadata", "annotations"); err != nil {
			return fmt.Errorf("stamp RustFS credential revision: %w", err)
		}
	}
	return nil
}
