package opensphere.production_test

import data.opensphere.authz.allow
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
