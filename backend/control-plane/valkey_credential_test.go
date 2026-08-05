package main

import (
	"encoding/base64"
	"testing"
)

func TestNewValkeyPasswordIsStrongAndNonDeterministic(t *testing.T) {
	first, err := newValkeyPassword()
	if err != nil {
		t.Fatalf("first password: %v", err)
	}
	second, err := newValkeyPassword()
	if err != nil {
		t.Fatalf("second password: %v", err)
	}
	if first == second {
		t.Fatal("password generator returned the same value twice")
	}
	if len(first) != 43 {
		t.Fatalf("password length = %d, want 43 base64url characters", len(first))
	}
	if _, err := base64.RawURLEncoding.DecodeString(first); err != nil {
		t.Fatalf("password is not valid unpadded base64url: %v", err)
	}
}
