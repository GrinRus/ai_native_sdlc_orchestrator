# Live E2E run-health report

## Purpose
Factual health report for the live E2E run itself.

This report answers whether the runner, controller, environment, provider connection, target checkout/setup, command execution, evidence persistence, and resume/interaction loop behaved well enough to trust the run as an execution attempt.

It must not evaluate outcome quality of produced artifacts, code, tests, security, performance, UI, UX, or accessibility. Those dimensions belong only in `live-e2e-quality-assessment-report`.

## Required fields
- `report_id`
- `run_id`
- `profile_id`
- `generated_at`
- `source_run_summary_file`
- `source_observation_report_file`
- `overall_status`
- `lifecycle_completion`
- `command_health`
- `controller_health`
- `provider_health`
- `target_environment_health`
- `diagnostic_health`
- `evidence_health`
- `failure_summary`
- `resume_interaction_health`
- `run_findings`
- `evidence_refs`

## Status semantics
`overall_status` is one of:
- `pass`
- `warn`
- `fail`
- `blocked`

`pass` means the full declared run completed and required run evidence was present.

`warn` means the run completed but had non-blocking run-quality gaps.

`fail` means the live E2E run failed as an execution attempt.

`blocked` means the run could not continue because of setup, provider, environment, operator, policy, or resumability blockers.

## Failure ownership
Non-passing reports must classify the primary run blocker in `failure_summary`:
- `owner`: `aor|target_repository|provider|environment|operator|unknown`
- `phase`: `aor_install|target_checkout|project_bootstrap|intake|readiness|target_setup|target_verification|provider_execution|review|controller_decision|ui_validation|delivery|release|learning|summary_write|unknown`
- `class`: non-empty machine-readable class
- `summary`: operator-readable explanation

Passing reports must set `failure_summary.owner` and `failure_summary.phase` to `null`.

## Section expectations
`lifecycle_completion` should include included steps, observed step count, accepted step count, pending steps, blocked step id, and continuation status.

`command_health` should include command count, failed command count, and failed command summaries.

`controller_health` should include controller-state refs, missing phase evidence, missing decisions, rejected decisions, and persistence gaps.

`provider_health` should include provider execution status, provider step status, interruption owner/status/reason, adapter evidence refs, request artifact refs, provider work packet refs, and context-budget facts when available.

For provider execution blocked before the external runtime starts because the bounded provider work packet is still too large, run-health must use:
- `failure_summary.owner: aor`
- `failure_summary.phase: provider_execution`
- `failure_summary.class: compiled_context_budget_exceeded`

For provider-reported prompt overflow after invocation, run-health must keep
pre-spawn budget facts separate. `provider_health.context_budget_status` remains
the measured provider work-packet status, while
`provider_health.context_budget_failure_class` and `failure_summary.class` use
`provider_context_window_exceeded`. Preserve `raw_provider_error_summary` plus
`adapter_raw_evidence_ref`; do not collapse this into a generic provider
blocker or the pre-spawn `compiled_context_budget_exceeded` class.

Malformed provider API/tool-call schema failures after invocation, including
OpenAI `invalid_request_error` and `property_name_above_max_length`, remain
provider execution failures. Run-health must keep
`failure_summary.owner=provider`, `failure_summary.phase=provider_execution`,
and the external runner failure class, while preserving a specific
`provider_health.raw_provider_error_summary` that names the malformed
Codex/OpenAI tool-call schema failure. These errors must not be reported as
target readiness or target verification blockers.

When the external runtime completes but only echoes or summarizes the provider work packet, run-health must preserve the execution failure as:
- `failure_summary.owner: provider`
- `failure_summary.phase: provider_execution`
- `failure_summary.class: provider_work_packet_not_executed`

When Runtime Harness detects a strict code-changing no-op after provider execution, run-health should preserve `failure_summary.class: no-op` with `phase: provider_execution` unless a more specific provider failure such as `provider_work_packet_not_executed` is available.

`target_readiness` should summarize pre-execution target facts as a first-class
block: target toolchain preflight, target setup status, target verification
status, pre-execution status refs, execution-readiness refs, failure
owner/phase/class, and whether product execution had started. It is still
factual run evidence and must not judge product quality.

`target_environment_health` should include target setup and target verification facts, without converting target repository failures into provider or AOR product failures.

`diagnostic_health` should include optional post-run diagnostic verification
facts, separated from the primary post-run verification gate:
- `status`
- `diagnostic_failure_mode`
- `post_run_diagnostic_status`
- `post_run_diagnostic_verify_summary_file`
- `timed_out_command_count`
- `failed_command_count`
- `timed_out_commands[]`
- `failed_commands[]`
- `evidence_refs[]`

`evidence_refs[]` may include the public `project verify` transcript when a
non-blocking diagnostic times out before a verify summary can be materialized.

If a configured diagnostic command times out or fails with
`diagnostic_failure_mode=warn`, run-health must use
`diagnostic_health.status: warn` and top-level `overall_status: warn`. This is a
factual run warning, not an outcome-quality verdict.

If a configured diagnostic command fails with `diagnostic_failure_mode=fail`,
run-health must use:
- `failure_summary.owner: target_repository`
- `failure_summary.phase: target_verification`
- `failure_summary.class: post_run_diagnostic_failed`

When baseline target verification passed but post-run target verification fails after provider execution, run-health must preserve the later post-run fact:
- `target_environment_health.target_verification_status: fail`
- `failure_summary.owner: target_repository`
- `failure_summary.phase: target_verification`
- `failure_summary.class: target_verification_failed`

This is still factual run-health classification. It does not evaluate whether the implementation idea was semantically good; the incomplete run must stop at run-health and must not produce an outcome quality assessment request.

When the public `execution#N -> review#N -> qa#N` quality cycle exhausts before
review passes, run-health must classify the terminal blocker from the final
review evidence instead of letting the next QA step fail with missing evidence:
- `failure_summary.owner: provider`
- `failure_summary.phase: review`
- `failure_summary.class: review_repair_loop_exhausted`

When review passes but QA-origin repair exhausts before delivery, run-health
must classify the QA blocker and must not prepare final product acceptance:
- `failure_summary.owner: target_repository` or `provider`
- `failure_summary.phase: qa`
- `failure_summary.class: qa_repair_loop_exhausted`

When review is non-passing and no repair action is available, but the configured repair loop was not exhausted, use `failure_summary.class: review_quality_not_approved`. Both cases are run-completion blockers; they are not substitutes for post-run outcome quality assessment because the declared flow did not complete.

When the next repair request would repeat the previous repair context without
new findings, changed paths, verification status, or evidence refs, use:
- `failure_summary.owner: provider`
- `failure_summary.phase: review`, `qa`, or `target_verification`
- `failure_summary.class: repeated_repair_context_without_new_evidence`

More specific convergence blockers may use
`provider_did_not_address_finding`, `review_finding_stale`,
`verification_mapping_gap`, or `acceptable_residual_risk_not_recognized` when
the public evidence supports that classification.

`evidence_health` should include missing evidence refs, weak evidence refs, and evidence ref counts.

`guided_ui_evidence` may mirror the observation report's guided UI/browser
proof refs so run-health consumers can see whether AOR operator browser-task
proof was required, present, and evidence-backed without interpreting outcome
quality. It should preserve web-smoke refs, browser-task request/proof refs,
screenshot refs, keyboard focus sequence, structured accessibility checks, weak
evidence refs, and supporting evidence refs when the profile declares
`browser-task-proof`.

For guided installed-user profiles that declare `live_e2e.frontend_capability: browser-task-proof`,
`guided_journey.browser_task_proof.required: true`, or `browser-task-proof` in proof requirements, missing or non-passing
AOR operator browser-task evidence is a factual run-health blocker, not an outcome-quality verdict:
- `failure_summary.owner: operator`
- `failure_summary.phase: ui_validation`
- `failure_summary.class: guided_browser_task_proof_missing`

The runner should still preserve deterministic app-smoke refs in `frontend_interactions[]`; `aor app --smoke` remains a
render guardrail and does not satisfy required browser-task proof by itself.
The corresponding `guided_browser_task_proof_request_file` should identify the
live browser inspection surface via `app_url`, `control_plane`, and
`app_server_pid`. `smoke_app_url` is only the short-lived render-guardrail URL
from `aor app --smoke`. The request should also carry the expected browser proof
file, deterministic HTML/DOM/accessibility/visual guardrail refs, and
`required_accessibility_checks[]`. Before final run-health classification, the
runner should rehydrate late browser proof into the guided web smoke evidence.
Missing proof, missing screenshot/visual evidence, or missing structured
accessibility check refs is a `guided_browser_task_proof_missing` blocker. The
quality of the AOR accessibility experience is assessed only later in
`live-e2e-quality-assessment-report`.

`resume_interaction_health` should include pending interactions, pending decisions, resume failures, and answer audit gaps.

`run_findings[]` are factual run findings. Each finding should include:
- `category`
- `severity`
- `summary`
- `evidence_refs`

## Forbidden fields
Run-health reports must not include:
- `quality_judgement`
- `runner_quality_summary`
- `final_skill_agent_verdict`
- `artifact_content_quality`
- `target_code_correctness`
- `target_ui_ux_quality`
- `ui_ux_quality`
- `accessibility_quality`
- `aor_operator_ui_ux_quality`
- `aor_operator_accessibility_quality`

## Relationship to qualification
Provider qualification should use run-health and factual run summary status. It must not depend on code/artifact/UI quality assessment. Medium+ product acceptance is separate and consumes step-quality reports plus the final all-pass quality gate.
