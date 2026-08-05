package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"regexp"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

var secretGVK = schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Secret"}
var sha256Hex = regexp.MustCompile(`^[A-F0-9]{64}$`)

func (r *modelReconciler) ensureSyncopePrerequisites(ctx context.Context, fmName, ns string) error {
	if fmName != "identity" {
		return nil
	}
	checks := []struct {
		name string
		keys map[string]func([]byte) bool
	}{
		{name: "foundation-identity-syncope-db-auth", keys: map[string]func([]byte) bool{
			"username": func(v []byte) bool { return string(v) == "syncope" },
			"password": func(v []byte) bool { return len(v) >= 24 },
			"uri":      func(v []byte) bool { return len(v) >= 40 },
		}},
		{name: "foundation-identity-syncope-runtime", keys: map[string]func([]byte) bool{
			"admin-password-sha256": func(v []byte) bool { return sha256Hex.Match(v) },
			"anonymous-user":        func(v []byte) bool { return len(v) >= 8 },
			"anonymous-key":         func(v []byte) bool { return len(v) >= 32 },
			"jws-key":               func(v []byte) bool { return len(v) >= 64 },
			"aes-secret":            func(v []byte) bool { return len(v) == 32 },
			"keystore-password":     func(v []byte) bool { return len(v) >= 16 },
		}},
	}
	for _, check := range checks {
		secret := gvkObj(secretGVK)
		if err := r.direct.Get(ctx, types.NamespacedName{Namespace: ns, Name: check.name}, secret); err != nil {
			return fmt.Errorf("Syncope prerequisite Secret/%s unavailable: %w", check.name, err)
		}
		data, _, _ := unstructured.NestedStringMap(secret.Object, "data")
		for key, valid := range check.keys {
			encoded := data[key]
			decoded, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil || !valid(decoded) {
				return fmt.Errorf("Syncope prerequisite Secret/%s key %q is missing or invalid", check.name, key)
			}
		}
	}
	return nil
}
