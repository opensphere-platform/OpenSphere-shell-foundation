package opensphere.production_test

import data.opensphere.authz.allow
import data.system.authz.allow as api_allowed
import data.system.log.mask

test_platform_admin_read_allowed if {
  allow with input as {"subject": {"authenticated": true, "roles": ["platform-admin"]}, "action": "read"}
}

test_anonymous_denied if {
  not allow with input as {"subject": {"authenticated": false, "roles": ["platform-admin"]}, "action": "read"}
}

test_unknown_action_denied if {
  not allow with input as {"subject": {"authenticated": true, "roles": ["platform-admin"]}, "action": "delete-all"}
}

test_decision_input_is_erased if {
  "/input" in mask
  "/nd_builtin_cache" in mask
}

test_mtls_metrics_endpoint_allowed if {
  api_allowed with input as {"identity": "CN=prometheus", "method": "GET", "path": ["metrics"]}
}

test_policy_mutation_api_denied if {
  not api_allowed with input as {"identity": "CN=platform-admin", "method": "PUT", "path": ["v1", "policies", "forbidden"]}
}
