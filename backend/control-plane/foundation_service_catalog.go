package main

import (
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// serviceModuleContract is the single northbound contract used by every PFSS
// module.  Product-specific operators remain free to use their native CRs on
// the southbound side; consumers do not need to know those implementation
// details.  An empty Endpoint means that the product driver is deliberately
// not bindable yet and must stay Pending (never fake Ready).
type serviceModuleContract struct {
	ID           string
	Model        string
	EngineID     string
	Driver       string
	RequestTypes []string
	RequestModes map[string]string
	Capabilities []string
	Dependencies []serviceDependency
	Endpoint     func(*config, *unstructured.Unstructured) string
	Probe        func(*config, *unstructured.Unstructured) string
}

type serviceDependency struct {
	Module      string
	RequestType string
	Required    bool
	Purpose     string
}

func dependency(module, requestType, purpose string, required bool) serviceDependency {
	return serviceDependency{Module: module, RequestType: requestType, Required: required, Purpose: purpose}
}

func withDependencies(c serviceModuleContract, dependencies ...serviceDependency) serviceModuleContract {
	c.Dependencies = append([]serviceDependency(nil), dependencies...)
	return c
}

func withRequestModes(c serviceModuleContract, modes map[string]string) serviceModuleContract {
	c.RequestModes = modes
	return c
}

func requestModes(values ...string) map[string]string {
	modes := map[string]string{}
	for i := 0; i+1 < len(values); i += 2 {
		modes[values[i]] = values[i+1]
	}
	return modes
}

func staticServiceEndpoint(scheme, service string, port int) func(*config, *unstructured.Unstructured) string {
	return func(cfg *config, fm *unstructured.Unstructured) string {
		ns := cfg.managedNS
		if fm != nil && fm.GetName() == "data" {
			ns = dataNS(cfg, fm)
		}
		return fmt.Sprintf("%s://%s.%s.svc:%d", scheme, service, ns, port)
	}
}

func staticServiceProbe(service string, port int) func(*config, *unstructured.Unstructured) string {
	return func(cfg *config, fm *unstructured.Unstructured) string {
		ns := cfg.managedNS
		if fm != nil && fm.GetName() == "data" {
			ns = dataNS(cfg, fm)
		}
		return fmt.Sprintf("%s.%s.svc:%d", service, ns, port)
	}
}

func contract(id, model, engine, driver string, requests, capabilities []string, scheme, service string, port int) serviceModuleContract {
	c := serviceModuleContract{ID: id, Model: model, EngineID: engine, Driver: driver, RequestTypes: requests, Capabilities: capabilities}
	if service != "" && port > 0 {
		c.Endpoint = staticServiceEndpoint(scheme, service, port)
		c.Probe = staticServiceProbe(service, port)
	}
	return c
}

// serviceModuleContracts contains the complete PFSS surface: 18 bundled
// plugins plus PostgreSQL, OpenSearch and Directory, which are independently
// packaged.  The request vocabulary is intentionally product-specific while
// the Claim/Binding lifecycle remains common.
var serviceModuleContracts = map[string]serviceModuleContract{
	"postgres": withRequestModes(contract("postgres", "data", "postgres", "stackgres", []string{"Instance", "Database", "Access"}, []string{"sql", "backup", "pooling", "extensions"}, "postgresql", "", 0),
		requestModes("Instance", "managed", "Database", "managed", "Access", "managed")),
	"percona-psmdb": withRequestModes(contract("percona-psmdb", "data", "psmdb", "percona-operator", []string{"Instance", "Database", "Access"}, []string{"mongodb", "replicaset", "backup"}, "mongodb", psmdbName+"-rs0", 27017),
		requestModes("Instance", "managed", "Database", "managed", "Access", "managed")),
	"valkey": withRequestModes(contract("valkey", "data", "valkey", "foundation-operator", []string{"Instance", "Access"}, []string{"resp", "acl", "persistence"}, "redis", valkeyName, 6379),
		requestModes("Instance", "shared", "Access", "managed")),
	"opensearch": withRequestModes(contract("opensearch", "data", "opensearch", "opensearch-operator", []string{"Instance", "Index", "Access"}, []string{"search", "index", "roles"}, "https", osStatefulSetName, 9200),
		requestModes("Instance", "shared", "Index", "managed", "Access", "managed")),
	"rustfs": withRequestModes(contract("rustfs", "data", "rustfs", "foundation-operator", []string{"Instance", "Bucket", "Access"}, []string{"s3", "bucket", "iam"}, "http", rustfsName, 9000),
		requestModes("Instance", "shared", "Bucket", "managed", "Access", "managed")),
	"keycloak": withRequestModes(contract("keycloak", "identity", "keycloak", "foundation-operator", []string{"Instance", "Realm", "Client", "Access"}, []string{"oidc", "oauth2", "realm"}, "http", keycloakName, 8080),
		requestModes("Instance", "shared", "Realm", "managed", "Client", "managed", "Access", "bind-existing")),
	"directory": withRequestModes(contract("directory", "identity", "samba", "directory-operator", []string{"Instance", "Directory", "Access"}, []string{"ldap", "ldaps", "kerberos", "dns"}, "ldaps", sambaName, 636),
		requestModes("Instance", "shared", "Directory", "bind-shared", "Access", "managed")),
	"apache-syncope": withDependencies(withRequestModes(contract("apache-syncope", "identity", "syncope", "foundation-operator", []string{"Instance", "Access"}, []string{"iga", "scim", "provisioning"}, "https", syncopeName, 8443),
		requestModes("Instance", "shared", "Access", "bind-existing")),
		dependency("postgres", "Instance", "durable IGA state", true)),
	"opa": withDependencies(withRequestModes(contract("opa", "identity", "opa", "foundation-operator", []string{"Instance", "Policy", "Access"}, []string{"rego", "decision", "bundle"}, "https", opaName, 8181),
		requestModes("Instance", "shared", "Policy", "bind-existing", "Access", "managed")),
		dependency("postgres", "Database", "decision audit log", true)),
	"litellm": withDependencies(withRequestModes(contract("litellm", "ai", "litellm", "ai-operator", []string{"Instance", "Route", "Access"}, []string{"openai-api", "model-route", "quota"}, "http", "foundation-ai-litellm", 4000),
		requestModes("Instance", "shared", "Route", "managed", "Access", "managed")),
		dependency("postgres", "Database", "routing and quota state", true)),
	"langfuse": withDependencies(withRequestModes(contract("langfuse", "ai", "langfuse", "ai-operator", []string{"Instance", "Project", "Access"}, []string{"llm-trace", "evaluation", "cost"}, "http", "foundation-ai-langfuse", 3000),
		requestModes("Instance", "shared", "Project", "bind-shared", "Access", "managed")),
		dependency("postgres", "Database", "application metadata", true),
		dependency("valkey", "Instance", "queue and cache", true)),
	"stalwart": withRequestModes(contract("stalwart", "communication", "stalwart", "communication-operator", []string{"Instance", "MailDomain", "Mailbox", "Access"}, []string{"smtp", "imap", "jmap"}, "https", "foundation-communication-stalwart", 443),
		requestModes("Instance", "shared", "MailDomain", "managed", "Mailbox", "managed", "Access", "bind-existing")),
	"novu": withDependencies(withRequestModes(contract("novu", "communication", "novu", "communication-operator", []string{"Instance", "Workflow", "Access"}, []string{"notification", "workflow", "subscriber"}, "http", "foundation-communication-novu-api", 3000),
		requestModes("Instance", "shared", "Workflow", "managed", "Access", "bind-existing")),
		dependency("percona-psmdb", "Database", "notification state", true), dependency("valkey", "Instance", "queue and cache", true)),
	"mattermost": withDependencies(withRequestModes(contract("mattermost", "communication", "mattermost", "communication-operator", []string{"Instance", "Workspace", "Access"}, []string{"chat", "chatops", "webhook"}, "http", "foundation-communication-mattermost", 8065),
		requestModes("Instance", "shared", "Workspace", "managed", "Access", "managed")),
		dependency("postgres", "Database", "workspace state", true), dependency("rustfs", "Bucket", "file storage", true)),
	"opentelemetry": withRequestModes(contract("opentelemetry", "observability", "otel", "foundation-operator", []string{"Instance", "Pipeline", "Access"}, []string{"otlp-grpc", "otlp-http", "metrics"}, "grpc", collectorName, 4317),
		requestModes("Instance", "shared", "Pipeline", "bind-shared", "Access", "bind-shared")),
	"grafana-tempo": withDependencies(withRequestModes(contract("grafana-tempo", "observability", "tempo", "foundation-operator", []string{"Instance", "Tenant", "Access"}, []string{"traces", "search", "service-graph"}, "http", tempoName, 3200),
		requestModes("Instance", "shared", "Tenant", "managed", "Access", "bind-existing")),
		dependency("rustfs", "Bucket", "production object storage", false)),
	"grafana-loki": withDependencies(withRequestModes(contract("grafana-loki", "observability", "loki", "foundation-operator", []string{"Instance", "Tenant", "Access"}, []string{"logs", "logql", "retention"}, "http", lokiName, 3100),
		requestModes("Instance", "shared", "Tenant", "managed", "Access", "bind-existing")),
		dependency("rustfs", "Bucket", "production object storage", false)),
	"grafana-operator": withRequestModes(contract("grafana-operator", "observability", "grafana-operator", "grafana-operator", []string{"Instance", "Dashboard", "DataSource", "Access"}, []string{"dashboard", "datasource", "alerting"}, "http", grafanaName+"-service", 3000),
		requestModes("Instance", "shared", "Dashboard", "managed", "DataSource", "managed", "Access", "managed")),
	"ptm": withDependencies(withRequestModes(contract("ptm", "backup", "ptm", "backup-operator", []string{"BackupPolicy", "Restore", "Access"}, []string{"backup", "restore", "point-in-time-manifest"}, "https", "velero.velero", 443),
		requestModes("BackupPolicy", "managed", "Restore", "managed", "Access", "bind-shared")),
		dependency("external:velero", "Instance", "Kubernetes backup engine", true),
		dependency("external:external-channel", "Bucket", "approved backup target", true)),
	"argocd": withRequestModes(contract("argocd", "delivery", "argocd", "argocd-operator", []string{"Application", "Project", "Access"}, []string{"gitops", "application", "sync"}, "https", "argocd-server.argocd", 443),
		requestModes("Application", "bind-existing", "Project", "bind-existing", "Access", "bind-shared")),
	"crossplane": withRequestModes(contract("crossplane", "delivery", "crossplane", "crossplane-operator", []string{"Provider", "Instance", "Access"}, []string{"provider", "composition", "managed-resource"}, "https", "kubernetes.default", 443),
		requestModes("Provider", "bind-existing", "Instance", "bind-existing", "Access", "bind-shared")),
}

func serviceContract(module string) (serviceModuleContract, bool) {
	c, ok := serviceModuleContracts[strings.TrimSpace(module)]
	return c, ok
}

func (c serviceModuleContract) supports(requestType string) bool {
	for _, candidate := range c.RequestTypes {
		if candidate == requestType {
			return true
		}
	}
	return false
}

func (c serviceModuleContract) requestMode(requestType string) string {
	return c.RequestModes[requestType]
}

func (c serviceModuleContract) requestReady(requestType string) bool {
	return c.requestMode(requestType) != "" && c.requestMode(requestType) != "pending"
}

func serviceModuleIDs() []string {
	ids := make([]string, 0, len(serviceModuleContracts))
	for id := range serviceModuleContracts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
