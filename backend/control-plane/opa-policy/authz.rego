package opensphere.authz

default allow := false

# The production baseline grants only authenticated platform administrators a
# small, explicit action vocabulary. Product-specific policies extend this
# namespace through reviewed bundle revisions; undefined input remains denied.
allow if {
  input.subject.authenticated == true
  "platform-admin" in object.get(input.subject, "roles", [])
  input.action in {"read", "list", "manage"}
}
