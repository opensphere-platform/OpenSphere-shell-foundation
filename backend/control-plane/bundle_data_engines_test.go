package main

import "testing"

func TestImageWithTagPreservesExactDigest(t *testing.T) {
	exact := "ghcr.io/opensphere-platform/mirror/valkey@sha256:c9b77919daeba2c02ad954d0c844cc4e7142069d177b89c5fd771f405daf9e02"
	if got := imageWithTag(exact, "9.1.0-alpine"); got != exact {
		t.Fatalf("exact digest changed to %q", got)
	}
}

func TestImageWithTagReplacesMutableTag(t *testing.T) {
	base := "ghcr.io/opensphere-platform/mirror/valkey:edge"
	want := "ghcr.io/opensphere-platform/mirror/valkey:9.1.0-alpine"
	if got := imageWithTag(base, "9.1.0-alpine"); got != want {
		t.Fatalf("imageWithTag() = %q, want %q", got, want)
	}
}
