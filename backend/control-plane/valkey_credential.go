package main

import (
	"context"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

const valkeyDefaultAuthSecret = "foundation-data-valkey-auth"

var coreSecretGVK = schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Secret"}

// ensureValkeyCredential validates the installer-owned exact Secret. It never
// creates or rotates credentials and never accepts an arbitrary Secret name.
func (r *modelReconciler) ensureValkeyCredential(ctx context.Context, fm *unstructured.Unstructured, ns string) error {
	model, _, _ := unstructured.NestedString(fm.Object, "spec", "model")
	if model != "data" || !engineEnabled(fm, "valkey") {
		return nil
	}

	opts := dataEngineParams(fm, r.cfg, "valkey")
	if opts.authSecret != valkeyDefaultAuthSecret {
		return fmt.Errorf("authSecret must be the platform-owned exact Secret %q", valkeyDefaultAuthSecret)
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
	return fmt.Errorf("required exact Secret %s/%s is missing; run the platform credential bootstrap", ns, valkeyDefaultAuthSecret)
}
