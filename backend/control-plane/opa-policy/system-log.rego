package system.log

# Decision outcomes are retained for audit, but the original policy input and
# non-deterministic cache are always erased before the event leaves OPA.
mask contains "/input"
mask contains "/nd_builtin_cache"
