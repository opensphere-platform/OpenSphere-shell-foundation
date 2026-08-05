package main

import (
	"strings"
	"testing"
)

func TestDecodeOPADecisionsAcceptsOnlyMaskedBooleanOutcomes(t *testing.T) {
	payload := `[{
  "decision_id":"d-1",
  "path":"opensphere/authz/allow",
  "result":false,
  "timestamp":"2026-08-05T00:00:00Z",
  "bundles":{"authz":{"revision":"opensphere-prod-test"}},
  "erased":["/input"],
  "labels":{"system":"opensphere"}
}]`
	events, err := decodeOPADecisions(strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].allow || events[0].revision != "opensphere-prod-test" {
		t.Fatalf("unexpected durable projection: %#v", events)
	}
}

func TestDecodeOPADecisionsRejectsRawInput(t *testing.T) {
	payload := `[{"decision_id":"d-2","path":"opensphere/authz/allow","result":true,"timestamp":"2026-08-05T00:00:00Z","input":{"token":"secret"}}]`
	_, err := decodeOPADecisions(strings.NewReader(payload))
	if err == nil || !strings.Contains(err.Error(), "unmasked input") {
		t.Fatalf("raw input must be rejected, got %v", err)
	}
}

func TestProductionBundleIsEmbedded(t *testing.T) {
	if len(opaProductionBundle) < 100 || opaProductionBundleRevision == "" {
		t.Fatal("signed production bundle artifact is missing")
	}
}
