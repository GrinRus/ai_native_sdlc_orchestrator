# Provider and model routing

## Purpose
Routing chooses how a step is executed without hard-coding provider behavior into orchestrator core.

## Inputs to route resolution
- step type and risk tier
- required adapter capabilities
- budget and timeout constraints
- project allowlists
- promotion channel and frozen state
- fallback policy
- current workflow mode such as execution, eval, or harness

## Route outputs
- adapter
- provider
- model alias or concrete model
- wrapper profile reference
- retry and repair profile references
- constraints such as timeout, cost, and scope expansion rules

## Routing rules
- prefer stable routes by default;
- allow explicit candidate routing for certification or controlled rehearsals;
- do not select routes whose required capabilities are missing;
- never bypass project allowlists;
- respect frozen or demoted assets.

## Deterministic precedence (W2-S01)
1. Start from `project-profile.default_route_profiles.<step_class>`.
2. Apply an explicit step override when provided.
3. Resolve the final `route_id` from the route registry.
4. Fail deterministically when the resolved profile is missing or points to a different `step`.

The route-resolution output should include selected source (`project-default` or `step-override`) so CLI/API surfaces can explain why a route was chosen.

## Route-to-policy handoff (W2-S03)
Route resolution feeds policy resolution directly:
- `route_class` selects the default policy source in `project-profile.default_step_policies`;
- `constraints.timeout_sec` and `constraints.max_cost_usd` become route-level defaults for execution bounds;
- route-level policy references (`retry_policy_ref`, `repair_policy_ref`) require compatible retry/repair fields in the resolved step policy.

If this handoff cannot resolve a complete policy envelope, execution planning must fail before any adapter call.
