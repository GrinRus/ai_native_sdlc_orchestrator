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
- `external_runner`
- `permission_denials`
- `requested_interaction`

These fields describe AOR runtime control decisions. They do not replace review, eval, delivery, learning, or promotion artifacts.
`external_runner` is a routed live-execution evidence summary copied from the adapter response when an external runtime was invoked. It should preserve the selected runtime-agent permission mode, permission mode source, command surface, execution root, exit metadata, and raw evidence ref when available.
`requested_interaction` is the operator-continuation surface for runner-requested input. It is optional and may be `null` when no operator input is required.

When present, `requested_interaction` must stay query-safe and should carry:
- `requested` (`true`);
- `interaction_id` when the runtime can assign a stable run-local id;
- `status` in `requested|answered|resumed|resume_failed|blocked`;
- `prompt_summary` or `summary` with a short sanitized question summary;
- `question_evidence_refs` or `evidence_refs` pointing at raw runner evidence;
- `answer_audit_refs` after an operator answer has been accepted;
- `continuation` with the intended control-plane next action (`resume_from_boundary|continue_run|remain_blocked`) and a reason code when blocked.
- `state_history[]` when the runtime has observed more than one continuation state for the same interaction.

The field must not embed sensitive answer text. Operator answers belong in durable audit evidence and may be referenced from this field after submission.
`state_history[]` is the durable query-safe ledger for interactive continuation. Each entry should include `status`, `timestamp`, optional sanitized `summary`, `evidence_refs[]`, optional `answer_audit_refs[]`, and optional `continuation`. It may record `requested`, `answered`, `resumed`, `resume_failed`, and `blocked` states for one `interaction_id`; it must never include raw operator answer text.
`repair_attempts` is the step-local Runtime Harness ledger. It should preserve the trigger, failure class, selected policy action, input evidence refs, repair route/compiled-context refs when executed, result, and budget exhaustion metadata. When repair executes, `input_evidence_refs` should include the generated repair input evidence that carries previous findings, failed step-result refs, diff status, adapter evidence, validator findings, and the current Runtime Harness report ref.
`mission_semantics` records the semantic validation evidence used by the step controller, including changed paths and strict no-op detection inputs when available.
For mission-scoped runs, `mission_semantics` should also preserve ignored request input files, allowed/forbidden path rules, mission-scoped changed paths, and scope violation paths so run-start decisions cannot be satisfied by control/input artifacts alone.

## Loader validation
The shared contract loader validates nested step-result fields that carry runtime control evidence:
- `evidence_refs[]` and nested evidence arrays must contain strings.
- `runtime_harness_decision` must use `pass|retry|repair|escalate|block|fail` when present.
- `requested_interaction` may be `null`; when present it must be an object with `requested` as a boolean, optional `status` in `requested|answered|resumed|resume_failed|blocked`, query-safe evidence refs, optional query-safe `state_history[]`, and no raw answer fields.
- `external_runner` must preserve `runtime_mode` and `command` when present; `raw_evidence_ref` is validated as a string when available, and `exit_code` is numeric when available or `null` for missing-command preflight failures.
- `repair_attempts[]` entries must be objects with `attempt`, `trigger`, `result`, and `input_evidence_refs[]`.
- `mission_semantics` path arrays must contain strings when present.

For `spec` routed steps, `routed_execution.discovery_research_gate` may carry the discovery research report status, ADR-ready flag, open questions, checks, and report refs from `aor discovery run`. This keeps ADR-readiness visible at specification handoff without making the spec step own research collection.
For later discovery/architecture maturity flows, `routed_execution` may include `discovery_completeness_gate` and `architecture_traceability` payloads so planning handoff is auditable.
For later operator troubleshooting maturity flows, `routed_execution.policy_resolution.governance_decision` should remain present when available so run-level policy history queries can avoid raw log inspection.

For MVP validation, `step_class` is a closed set:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`
