package system.authz

default allow := false

# mTLS authentication populates input.identity. Only the governed OpenSphere
# decision namespace is reachable; policy/data mutation and ad-hoc APIs remain
# unavailable even to authenticated clients.
allow if {
  is_string(input.identity)
  input.identity != ""
  input.method == "POST"
  count(input.path) >= 3
  input.path[0] == "v1"
  input.path[1] == "data"
  input.path[2] == "opensphere"
}

# Prometheus presents a certificate issued by the dedicated OPA CA. Expose only
# the read-only diagnostic metrics endpoint; all policy/data mutation APIs stay
# fail-closed.
allow if {
  is_string(input.identity)
  input.identity != ""
  input.method == "GET"
  input.path == ["metrics"]
}
