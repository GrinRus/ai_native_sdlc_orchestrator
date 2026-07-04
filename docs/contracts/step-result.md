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
`project verify` runner step results may add command-level evidence so bounded verification is machine-readable in addition to the transcript evidence:
- `command_group_id`, `command_group_role`, `command_group_phase`, `command_group_enforcement`, `command_group_timeout_class`, and `enforcement_result`;
- `command_group_outcome` when generic verification needs to preserve
  `no-tests`, `missing-tool`, `not-applicable`, or `broken-baseline` evidence;
- `working_dir` for the repo-relative directory used by a command group;
- `command_timeout_ms` and `timed_out`;
- `started_at`, `finished_at`, and `duration_ms`;
- `exit_code`, `signal`, and `error_code`;
- `output_excerpt.stdout_tail` and `output_excerpt.stderr_tail`.
- `output_quality_findings[]` when an exit-0 command still emits high-signal warning output such as Python or Node warning tokens in stderr; these findings are bounded, query-safe evidence and make the command result `failed` unless a current `project verify` run marks the same warning class from a prior verify summary as `baseline_status=pre_existing`.
Catalog-backed runner steps may carry `routed_execution.feature_traceability.required_path_prefixes[]`. This is read-model traceability for `execution_evidence.real_code_change_status`: it identifies the minimum repository surfaces that can prove a mission-relevant change. It is not an allowed/forbidden path gate and must not replace review, verification, or delivery evidence.
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
`external_runner` is a routed live-execution evidence summary copied from the adapter response when an external runtime was invoked. It should preserve the selected runtime-agent permission mode, permission mode source, command surface, execution root, exit metadata, raw evidence ref, request artifact refs, provider work packet refs, and context-budget status when available.
If an external runtime returns a provider work-packet echo or packet summary instead of an implementation report, the adapter should classify the response with `failure_kind=provider_work_packet_not_executed`. The step result should preserve that failure class so Runtime Harness can distinguish prompt/packet execution failures from target repository failures.
`requested_interaction` is the operator-continuation surface for runner-requested input. It is optional and may be `null` when no operator input is required.

When present, `requested_interaction` must stay query-safe and should carry:
- `requested` (`true`);
- `interaction_type` in `permission_request|clarification_question|auth_required` when known;
- `interaction_id` when the runtime can assign a stable run-local id;
- `status` in `requested|answered|resumed|resume_failed|blocked`;
- `prompt_summary` or `summary` with a short sanitized question summary;
- `question_evidence_refs` or `evidence_refs` pointing at raw runner evidence;
- `answer_audit_refs` after an operator answer has been accepted;
- `continuation` with the intended control-plane next action (`resume_from_boundary|continue_run|remain_blocked`) and a reason code when blocked.
- `state_history[]` when the runtime has observed more than one continuation state for the same interaction.
- `runtime_permission_request` for permission interactions, with adapter id, runner family, selected permission mode, operation type, sanitized target or command, confidence, and evidence refs.
- `runtime_permission_decision` for permission interactions, with decision, rule id, approval scope, continuation strategy, optional operator decision, and audit ref.

The field must not embed sensitive answer text. Operator answers belong in durable audit evidence and may be referenced from this field after submission.
Permission requests may also be summarized at top level as `runtime_permission_request` and `runtime_permission_decision` so Runtime Harness reports and policy history can inspect auto decisions even when no user-facing `requested_interaction` was needed.
`state_history[]` is the durable query-safe ledger for interactive continuation. Each entry should include `status`, `timestamp`, optional sanitized `summary`, `evidence_refs[]`, optional `answer_audit_refs[]`, and optional `continuation`. It may record `requested`, `answered`, `resumed`, `resume_failed`, and `blocked` states for one `interaction_id`; it must never include raw operator answer text.
`repair_attempts` is the step-local Runtime Harness ledger. It should preserve the trigger, failure class, selected policy action, input evidence refs, repair route/compiled-context refs when executed, result, and budget exhaustion metadata. When repair executes, `input_evidence_refs` should include the generated repair input evidence that carries previous findings, failed step-result refs, diff status, adapter evidence, validator findings, and the current Runtime Harness report ref.
`mission_semantics` records the semantic validation evidence used by the step controller, including changed paths, meaningful changed paths, runner-owned local state paths, ignored request input files, and strict no-op detection inputs when available. Runtime Harness no longer emits allowed/forbidden path gates, mission-scoped changed paths, or scope-violation paths as implementation-quality verdicts.
`runner_owned_state_paths[]` and `runner_owned_state_paths_during_step[]` identify local runner configuration or skill state such as `.codex/`, `.claude/`, `.qwen/`, or `.opencode/` that appeared inside the target checkout. For live runner execution, these paths are not acceptable upstream patch material; Runtime Harness must classify them with `failure_class=runner-owned-state-leak` and `runtime_harness_decision=block`.

## Loader validation
The shared contract loader validates nested step-result fields that carry runtime control evidence:
- `evidence_refs[]` and nested evidence arrays must contain strings.
- `runtime_harness_decision` must use `pass|retry|repair|escalate|block|fail` when present.
- `project verify` command evidence is optional for backward compatibility, but when present `exit_code` is numeric or `null`, `signal` and `error_code` are strings or `null`, `output_excerpt` must stay a bounded summary rather than a full transcript, and `output_quality_findings[]` entries must carry string `rule_id`, `source`, `severity`, `summary`, and optional bounded `excerpt`. Baseline-accepted warning findings may add string `baseline_status` and `baseline_evidence_refs[]` pointing to the prior verify summaries that prove the warning class was pre-existing.
- `requested_interaction` may be `null`; when present it must be an object with `requested` as a boolean, optional `status` in `requested|answered|resumed|resume_failed|blocked`, query-safe evidence refs, optional query-safe `state_history[]`, and no raw answer fields.
- `external_runner` must preserve `runtime_mode` and `command` when present; `raw_evidence_ref`, `request_artifact_ref`, `provider_work_packet_ref`, `context_budget_status`, `context_budget_failure_class`, and `raw_provider_error_summary` are validated as strings when available; `top_context_size_sources[]` entries must be objects with source labels and numeric size estimates; and `exit_code` is numeric when available or `null` for missing-command preflight failures.
- `repair_attempts[]` entries must be objects with `attempt`, `trigger`, `result`, and `input_evidence_refs[]`.
- `mission_semantics` path arrays, including `runner_owned_state_paths[]` and `runner_owned_state_paths_during_step[]`, must contain strings when present. Legacy `allowed_paths`, `forbidden_paths`, `mission_scoped_changed_paths`, and `scope_violation_paths` must not be emitted.

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
