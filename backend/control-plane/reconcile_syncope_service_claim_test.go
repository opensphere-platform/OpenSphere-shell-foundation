package main

import "testing"

func TestSyncopeAccessRequiresExistingIGACredential(t *testing.T) {
	contract, _ := serviceContract("apache-syncope")
	if contract.requestMode("Access") != "bind-existing" || !contract.requestReady("Access") {
		t.Fatal("Syncope Access must bind an explicitly supplied IGA service credential")
	}
}
