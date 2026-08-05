package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestSyncopeCoreHealthyAcceptsOnlyOptionalMailFailure(t *testing.T) {
	body := `{"status":"DOWN","components":{"domains":{"status":"UP"},"externalResources":{"status":"UP"},"livenessState":{"status":"UP"},"mail":{"status":"DOWN"},"ping":{"status":"UP"},"readinessState":{"status":"UP"}}}`
	if !syncopeCoreHealthy(http.StatusServiceUnavailable, strings.NewReader(body)) {
		t.Fatal("expected SMTP-only failure to preserve Core readiness")
	}
}

func TestSyncopeCoreHealthyRejectsRequiredComponentFailure(t *testing.T) {
	body := `{"status":"DOWN","components":{"domains":{"status":"DOWN"},"livenessState":{"status":"UP"},"mail":{"status":"DOWN"},"ping":{"status":"UP"},"readinessState":{"status":"UP"}}}`
	if syncopeCoreHealthy(http.StatusServiceUnavailable, strings.NewReader(body)) {
		t.Fatal("expected domain failure to reject Core readiness")
	}
}

func TestSyncopeCoreHealthyRejectsMalformedHealth(t *testing.T) {
	if syncopeCoreHealthy(http.StatusServiceUnavailable, strings.NewReader(`{"status":`)) {
		t.Fatal("expected malformed actuator response to reject Core readiness")
	}
}
