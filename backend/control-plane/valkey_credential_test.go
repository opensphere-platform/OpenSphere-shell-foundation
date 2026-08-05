package main

import "testing"

func TestValkeyCredentialNameIsExact(t *testing.T) {
	if valkeyDefaultAuthSecret != "foundation-data-valkey-auth" {
		t.Fatalf("unexpected Valkey credential name %q", valkeyDefaultAuthSecret)
	}
}
