# Provider route profile

## Purpose
Execution route for a step, including adapter/provider/model choice, optional
reasoning effort, required capabilities, fallbacks, and constraints.

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
`model_source`, requested/effective reasoning effort, capability requirements,
and an attempt budget. Model resolution uses this precedence: a concrete model
supported by the adapter, a declared adapter-owned alias, then the runner-native
default when no model was requested. Reasoning effort follows the same
explicit-or-native policy. Unknown or incompatible values fail before
subprocess spawn.

Each primary or fallback candidate may optionally declare `model` and
`reasoning_effort`. When omitted, the selected external runtime owns its native
default; provider-specific flags must remain inside the adapter profile.

Isolated rehearsal materialization records a query-safe selection readback
beside the generated route assets. The readback carries `requested_model`,
`requested_reasoning_effort`, and a source (`profile`, `provider-variant`, or
`runner-default`), plus SHA-256 digests for the source and generated route
files. These digests prove that run-scoped route generation did not mutate the
source profile or silently change an unselected provider variant.

Strict live or write-capable routes may add `required_output_schema_ref` and
`required_output_mode`. When present, the selected adapter must explicitly
declare the schema ref in `supported_schema_refs[]` and the mode in
`supported_output_modes[]`; the legacy `structured_output` boolean alone does
not qualify the route.

Each fallback candidate may execute at most once, in declared order, only when
its adapter satisfies the same capability requirements and the canonical
failure class is listed by the resolved retry policy. Exhaustion and skipped
incompatible candidates are durable route-transition evidence, not an implicit
retry of the primary route.

## Example
See `examples/routes/*.yaml`.
