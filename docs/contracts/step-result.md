# Step result

## Purpose
Normalized output of one step regardless of whether that step was an artifact, planner, runner, repair, eval, or harness step.

## Required fields
- `step_result_id`
- `run_id`
- `step_id`
- `step_class`
- `status`
- `summary`
- `evidence_refs`

## Notes
Step results make routing, validation, and quality logic consistent across the lifecycle.
Execution engines may add replay metadata (for example route/asset/policy/adapter selections, timestamps, dry-run mode, and blocked-next-step guidance) as optional fields.
For later discovery/architecture maturity flows, `routed_execution` may include `discovery_completeness_gate` and `architecture_traceability` payloads so planning handoff is auditable.
For later operator troubleshooting maturity flows, `routed_execution.policy_resolution.governance_decision` should remain present when available so run-level policy history queries can avoid raw log inspection.

For MVP validation, `step_class` is a closed set:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`
