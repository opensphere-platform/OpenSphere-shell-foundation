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

// ensureValkeyCredential validates the installer-owned exact Secret and returns
// its resourceVersion. The version is stamped into the Valkey Pod template so an
// exact-name Console rotation causes a controlled rolling restart. This method
// never creates or rotates credentials and never accepts an arbitrary Secret.
func (r *modelReconciler) ensureValkeyCredential(ctx context.Context, fm *unstructured.Unstructured, ns string) (string, error) {
	model, _, _ := unstructured.NestedString(fm.Object, "spec", "model")
	if model != "data" || !engineEnabled(fm, "valkey") {
		return "", nil
	}

	opts := dataEngineParams(fm, r.cfg, "valkey")
	if opts.authSecret != valkeyDefaultAuthSecret {
		return "", fmt.Errorf("authSecret must be the platform-owned exact Secret %q", valkeyDefaultAuthSecret)
	}

	secret := gvkObj(coreSecretGVK)
	err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: opts.authSecret}, secret)
	if err == nil {
		password, found, nestedErr := unstructured.NestedString(secret.Object, "data", "password")
		if nestedErr != nil || !found || password == "" {
			return "", fmt.Errorf("Secret %s/%s exists but data.password is missing", ns, opts.authSecret)
		}
		return secret.GetResourceVersion(), nil
	}
	if !apierrors.IsNotFound(err) {
		return "", fmt.Errorf("read Secret %s/%s: %w", ns, opts.authSecret, err)
	}
	return "", fmt.Errorf("required exact Secret %s/%s is missing; run the platform credential bootstrap", ns, valkeyDefaultAuthSecret)
}

func stampValkeyCredentialRevision(objs []*unstructured.Unstructured, resourceVersion string) error {
	if resourceVersion == "" {
		return nil
	}
	for _, obj := range objs {
		if obj.GetKind() != "StatefulSet" || obj.GetName() != valkeyName {
			continue
		}
		annotations, _, err := unstructured.NestedStringMap(obj.Object, "spec", "template", "metadata", "annotations")
		if err != nil {
			return fmt.Errorf("read Valkey Pod template annotations: %w", err)
		}
		if annotations == nil {
			annotations = map[string]string{}
		}
		annotations["foundation.opensphere.io/valkey-credential-resource-version"] = resourceVersion
		if err := unstructured.SetNestedStringMap(obj.Object, annotations, "spec", "template", "metadata", "annotations"); err != nil {
			return fmt.Errorf("stamp Valkey credential revision: %w", err)
		}
	}
	return nil
}
