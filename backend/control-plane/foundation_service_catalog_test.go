package main

import (
	"strings"
	"testing"
)

func TestServiceCatalogCoversEveryPFSSModule(t *testing.T) {
	want := []string{
		"apache-syncope", "argocd", "crossplane", "directory", "grafana-loki",
		"grafana-operator", "grafana-tempo", "keycloak", "langfuse", "litellm",
		"mattermost", "novu", "opa", "opensearch", "opentelemetry", "percona-psmdb",
		"postgres", "ptm", "rustfs", "stalwart", "valkey",
	}
	got := serviceModuleIDs()
	if len(got) != len(want) {
		t.Fatalf("PFSS module contract count=%d, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("PFSS module contract[%d]=%q, want %q", i, got[i], want[i])
		}
		c, ok := serviceContract(want[i])
		if !ok || c.Model == "" || c.EngineID == "" || c.Driver == "" || len(c.RequestTypes) == 0 || len(c.Capabilities) == 0 {
			t.Fatalf("incomplete PFSS module contract: %#v", c)
		}
		for _, requestType := range c.RequestTypes {
			mode := c.requestMode(requestType)
			if mode != "managed" && mode != "shared" && mode != "bind-existing" && mode != "bind-shared" && mode != "pending" {
				t.Fatalf("%s request %s has invalid implementation mode %q", c.ID, requestType, mode)
			}
		}
	}
}

func TestEveryPublishedProductOperationHasAReadyDriver(t *testing.T) {
	for module, contract := range serviceModuleContracts {
		for _, requestType := range contract.RequestTypes {
			if !contract.requestReady(requestType) {
				t.Errorf("%s/%s is published without an implemented driver", module, requestType)
			}
		}
	}
}

func TestPTMExposesManagedPolicyAndVerifiedRestoreLifecycle(t *testing.T) {
	contract, _ := serviceContract("ptm")
	for requestType, mode := range map[string]string{"BackupPolicy": "managed", "Restore": "managed", "Access": "bind-shared"} {
		if contract.requestMode(requestType) != mode || !contract.requestReady(requestType) {
			t.Errorf("PTM %s must be %s", requestType, mode)
		}
	}
}

func TestDirectorySeparatesSharedEndpointFromManagedAccess(t *testing.T) {
	contract, _ := serviceContract("directory")
	if contract.requestMode("Directory") != "bind-shared" || !contract.requestReady("Directory") {
		t.Fatal("Directory request must bind to the shared AD realm")
	}
	if contract.requestMode("Access") != "managed" || !contract.requestReady("Access") {
		t.Fatal("Directory Access must create a scoped LDAP service account")
	}
}

func TestKeycloakExposesManagedRealmAndClientLifecycle(t *testing.T) {
	contract, _ := serviceContract("keycloak")
	for requestType, mode := range map[string]string{"Realm": "managed", "Client": "managed", "Access": "bind-existing"} {
		if contract.requestMode(requestType) != mode || !contract.requestReady(requestType) {
			t.Errorf("Keycloak %s must be %s", requestType, mode)
		}
	}
}

func TestOpenTelemetryPipelineBindsToTheImplementedSharedBridge(t *testing.T) {
	contract, _ := serviceContract("opentelemetry")
	if contract.requestMode("Pipeline") != "bind-shared" || !contract.requestReady("Pipeline") {
		t.Fatal("OpenTelemetry Pipeline must bind to the configured shared collector bridge")
	}
}

func TestServiceCatalogKeepsProductSpecificRequestKinds(t *testing.T) {
	cases := map[string]string{
		"postgres": "Database", "rustfs": "Bucket", "opensearch": "Index",
		"keycloak": "Realm", "directory": "Directory", "opa": "Policy",
		"litellm": "Route", "langfuse": "Project", "stalwart": "Mailbox",
		"novu": "Workflow", "mattermost": "Workspace", "opentelemetry": "Pipeline",
		"grafana-tempo": "Tenant", "grafana-loki": "Tenant", "grafana-operator": "Dashboard",
		"ptm": "Restore", "argocd": "Application", "crossplane": "Provider",
	}
	for module, requestType := range cases {
		contract, _ := serviceContract(module)
		if !contract.supports(requestType) {
			t.Errorf("%s must support %s", module, requestType)
		}
	}
}

func TestObservabilityStoresExposeAuthenticatedTenantLifecycle(t *testing.T) {
	for _, module := range []string{"grafana-tempo", "grafana-loki"} {
		contract, _ := serviceContract(module)
		if contract.requestMode("Instance") != "shared" || !contract.requestReady("Instance") {
			t.Errorf("%s shared Instance must be available", module)
		}
		for requestType, mode := range map[string]string{"Tenant": "managed", "Access": "bind-existing"} {
			if contract.requestMode(requestType) != mode || !contract.requestReady(requestType) {
				t.Errorf("%s/%s must use %s authenticated tenant lifecycle", module, requestType, mode)
			}
		}
	}
}

func TestGrafanaOperatorExposesDeclarativeContentAndAccessLifecycle(t *testing.T) {
	contract, _ := serviceContract("grafana-operator")
	for requestType, mode := range map[string]string{
		"Instance": "shared", "Dashboard": "managed", "DataSource": "managed", "Access": "managed",
	} {
		if contract.requestMode(requestType) != mode || !contract.requestReady(requestType) {
			t.Errorf("Grafana %s must use %s operator lifecycle", requestType, mode)
		}
	}
}

func TestServiceDependenciesReferenceKnownOrExplicitExternalModules(t *testing.T) {
	for id, contract := range serviceModuleContracts {
		for _, dependency := range contract.Dependencies {
			if dependency.Module == "" || dependency.RequestType == "" || dependency.Purpose == "" {
				t.Fatalf("%s has incomplete dependency: %#v", id, dependency)
			}
			if _, known := serviceModuleContracts[dependency.Module]; !known && !strings.HasPrefix(dependency.Module, "external:") {
				t.Fatalf("%s depends on unknown module %s", id, dependency.Module)
			}
		}
	}
}
