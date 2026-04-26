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
Runtime Harness controllers may add optional decision metadata:
- `mission_outcome` (`satisfied|not_satisfied|not_applicable|unknown`)
- `failure_class`
- `runtime_harness_decision` (`pass|retry|repair|escalate|block|fail`)
- `repair_attempts`
- `repair_status`
- `stage_timings`
- `mission_semantics`
- `permission_denials`
- `requested_interaction`

These fields describe AOR runtime control decisions. They do not replace review, eval, delivery, learning, or promotion artifacts.
`repair_attempts` is the step-local Runtime Harness ledger. It should preserve the trigger, failure class, selected policy action, input evidence refs, repair route/compiled-context refs when executed, result, and budget exhaustion metadata. When repair executes, `input_evidence_refs` should include the generated repair input evidence that carries previous findings, failed step-result refs, diff status, adapter evidence, validator findings, and the current Runtime Harness report ref.
`mission_semantics` records the semantic validation evidence used by the step controller, including changed paths and strict no-op detection inputs when available.
For mission-scoped runs, `mission_semantics` should also preserve ignored request input files, allowed/forbidden path rules, mission-scoped changed paths, and scope violation paths so run-start decisions cannot be satisfied by control/input artifacts alone.
For later discovery/architecture maturity flows, `routed_execution` may include `discovery_completeness_gate` and `architecture_traceability` payloads so planning handoff is auditable.
For later operator troubleshooting maturity flows, `routed_execution.policy_resolution.governance_decision` should remain present when available so run-level policy history queries can avoid raw log inspection.

For MVP validation, `step_class` is a closed set:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`
