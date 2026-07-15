# Provider route profile

## Purpose
Execution route for a step, including adapter/provider/model choice, required capabilities, fallbacks, and constraints.

## Required fields
- `route_id`
- `step`
- `route_class`
- `risk_tier`
- `primary`

## Notes
Routes should also declare fallback behavior, required adapter capabilities, and promotion channel.
Route resolution should be deterministic: step-level override first, then `project-profile.default_route_profiles`.
If a resolved route points to a different `step`, resolution must fail with an explicit conflict.

The resolved route preserves ordered `fallback[]`, `retry_policy_ref`, and
`repair_policy_ref`. It also exposes `requested_model`, `effective_model`,
`model_source`, capability requirements, and an attempt budget. Model resolution
uses this precedence: a concrete model supported by the adapter, a declared
adapter-owned alias, then the adapter default when no model was requested.
Unknown or incompatible models fail before subprocess spawn.

Each fallback candidate may execute at most once, in declared order, only when
its adapter satisfies the same capability requirements and the canonical
failure class is listed by the resolved retry policy. Exhaustion and skipped
incompatible candidates are durable route-transition evidence, not an implicit
retry of the primary route.

## Example
See `examples/routes/*.yaml`.
