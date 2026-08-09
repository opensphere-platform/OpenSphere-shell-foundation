package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOPAClientCertificateUsesDedicatedIdentityAndIssuer(t *testing.T) {
	claim := stalwartTestClaim("Access", map[string]interface{}{})
	claim.SetName("policy-consumer")
	certificate := opaClientCertificate(&config{managedNS: "opensphere-foundation"}, claim)
	encoded, _ := json.Marshal(certificate.Object)
	text := string(encoded)
	for _, expected := range []string{`"kind":"Certificate"`, `"namespace":"opensphere-foundation"`, `"kind":"Issuer"`, `"name":"foundation-identity-opa-ca"`, `"usages":["client auth"]`} {
		if !strings.Contains(text, expected) {
			t.Errorf("OPA client Certificate is missing %s: %s", expected, text)
		}
	}
	if strings.Contains(text, "foundation-identity-opa-consumer-tls") {
		t.Fatalf("shared OPA consumer credential leaked into per-claim Certificate: %s", text)
	}
}

func TestOPACatalogBindsReviewedPolicyAndManagesPerClaimAccess(t *testing.T) {
	contract, _ := serviceContract("opa")
	if contract.requestMode("Policy") != "bind-existing" || !contract.requestReady("Policy") {
		t.Fatal("OPA Policy must bind to a reviewed signed-bundle policy")
	}
	if contract.requestMode("Access") != "managed" || !contract.requestReady("Access") {
		t.Fatal("OPA Access must issue a dedicated mTLS client certificate")
	}
}

func TestOPAPolicyPathDefaultsToReviewedEntryPoint(t *testing.T) {
	claim := stalwartTestClaim("Policy", map[string]interface{}{})
	if path := opaPolicyPath(claim); path != "opensphere/authz/allow" {
		t.Fatalf("policy path=%q", path)
	}
}
