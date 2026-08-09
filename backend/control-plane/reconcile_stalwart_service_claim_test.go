package main

import (
	"encoding/json"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func stalwartTestClaim(requestType string, parameters map[string]interface{}) *unstructured.Unstructured {
	claim := gvkObj(fcGVK)
	claim.SetNamespace("tenant-a")
	claim.SetName("orders-mail")
	claim.Object["spec"] = map[string]interface{}{
		"model":      "communication",
		"request":    map[string]interface{}{"type": requestType},
		"parameters": parameters,
	}
	return claim
}

func TestStalwartMailDomainPlanIsIdempotentUpsert(t *testing.T) {
	claim := stalwartTestClaim("MailDomain", map[string]interface{}{"domain": "Mail.Example.COM"})
	plan, domain, localPart, valid := stalwartPlan(claim, "")
	if !valid || domain != "mail.example.com" || localPart != "" {
		t.Fatalf("plan coordinates valid=%v domain=%q local=%q", valid, domain, localPart)
	}
	var operation map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(plan)), &operation); err != nil {
		t.Fatal(err)
	}
	if operation["@type"] != "upsert" || operation["object"] != "Domain" {
		t.Fatalf("unexpected domain operation: %#v", operation)
	}
	matchOn, _ := operation["matchOn"].([]interface{})
	if len(matchOn) != 1 || matchOn[0] != "name" {
		t.Fatalf("domain natural key=%v", operation["matchOn"])
	}
}

func TestStalwartMailboxPlanUsesDomainReferenceAndNeverAdminCredential(t *testing.T) {
	claim := stalwartTestClaim("Mailbox", map[string]interface{}{
		"domain": "example.com", "localPart": "orders.bot", "displayName": "Orders automation",
	})
	password := "generated-mailbox-password-123456789"
	plan, domain, localPart, valid := stalwartPlan(claim, password)
	if !valid || domain != "example.com" || localPart != "orders.bot" {
		t.Fatalf("plan coordinates valid=%v domain=%q local=%q", valid, domain, localPart)
	}
	lines := strings.Split(strings.TrimSpace(plan), "\n")
	if len(lines) != 2 {
		t.Fatalf("plan lines=%d: %s", len(lines), plan)
	}
	var accountOperation map[string]interface{}
	if err := json.Unmarshal([]byte(lines[1]), &accountOperation); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(accountOperation)
	text := string(encoded)
	for _, expected := range []string{`"@type":"upsert"`, `"object":"Account"`, `"matchOn":["name","domainId"]`, `"domainId":"#mail-domain"`, password} {
		if !strings.Contains(text, expected) {
			t.Errorf("mailbox plan is missing %s: %s", expected, text)
		}
	}
	for _, forbidden := range []string{"opensphere-recovery", "stalwart-admin", "STALWART_PASSWORD"} {
		if strings.Contains(text, forbidden) {
			t.Errorf("mailbox plan leaked administration detail %q: %s", forbidden, text)
		}
	}
}

func TestStalwartPlanRejectsMissingAndMalformedCoordinates(t *testing.T) {
	cases := []*unstructured.Unstructured{
		stalwartTestClaim("MailDomain", map[string]interface{}{}),
		stalwartTestClaim("MailDomain", map[string]interface{}{"domain": "not-a-domain"}),
		stalwartTestClaim("Mailbox", map[string]interface{}{"domain": "example.com", "localPart": "bad local"}),
	}
	for index, claim := range cases {
		if _, _, _, valid := stalwartPlan(claim, "generated-mailbox-password-123456789"); valid {
			t.Errorf("case %d unexpectedly accepted", index)
		}
	}
	if value := stalwartString(map[string]interface{}{"domain": 42}, "domain"); value != "" {
		t.Fatalf("non-string parameter became %q", value)
	}
}

func TestStalwartApplyJobIsCredentialSafeAndHardened(t *testing.T) {
	claim := stalwartTestClaim("MailDomain", map[string]interface{}{"domain": "example.com"})
	job := stalwartApplyJob(&config{managedNS: "opensphere-foundation", stalwartCLIImage: "mirror/stalwart-cli:0.16.13"}, claim, "mail-plan", "sha256:abc")
	encoded, _ := json.Marshal(job.Object)
	text := string(encoded)
	for _, expected := range []string{
		`"automountServiceAccountToken":false`, `"image":"mirror/stalwart-cli:0.16.13"`,
		`"args":["apply","--file","/plan/plan.ndjson","--json"]`, `"secretName":"mail-plan"`,
		`"secretKeyRef":{"key":"stalwart-admin-user","name":"foundation-communication-runtime"}`,
		`"secretKeyRef":{"key":"stalwart-admin-password","name":"foundation-communication-runtime"}`,
		`"allowPrivilegeEscalation":false`, `"readOnlyRootFilesystem":true`,
	} {
		if !strings.Contains(text, expected) {
			t.Errorf("apply Job is missing %s: %s", expected, text)
		}
	}
	if strings.Contains(text, "opensphere-recovery") {
		t.Fatalf("apply Job contains a literal administration identity: %s", text)
	}
}
