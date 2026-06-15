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
- `phase`: `aor_install|target_checkout|project_bootstrap|intake|readiness|target_setup|target_verification|provider_execution|controller_decision|ui_validation|delivery|release|learning|summary_write|unknown`
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

For provider-reported prompt overflow after invocation, run-health should still classify the issue as context-budget related and preserve `raw_provider_error_summary` plus `adapter_raw_evidence_ref`; it must not collapse this into a generic provider blocker.

When the external runtime completes but only echoes or summarizes the provider work packet, run-health must preserve the execution failure as:
- `failure_summary.owner: provider`
- `failure_summary.phase: provider_execution`
- `failure_summary.class: provider_work_packet_not_executed`

When Runtime Harness detects a strict code-changing no-op after provider execution, run-health should preserve `failure_summary.class: no-op` with `phase: provider_execution` unless a more specific provider failure such as `provider_work_packet_not_executed` is available.

`target_environment_health` should include target setup and target verification facts, without converting target repository failures into provider or AOR product failures.

When baseline target verification passed but post-run target verification fails after provider execution, run-health must preserve the later post-run fact:
- `target_environment_health.target_verification_status: fail`
- `failure_summary.owner: target_repository`
- `failure_summary.phase: target_verification`
- `failure_summary.class: target_verification_failed`

This is still factual run-health classification. It does not evaluate whether the implementation idea was semantically good; the incomplete run must stop at run-health and must not produce an outcome quality assessment request.

`evidence_health` should include missing evidence refs, weak evidence refs, and evidence ref counts.

For guided installed-user profiles that declare `live_e2e.frontend_capability: browser-task-proof`,
`guided_journey.browser_task_proof.required: true`, or `browser-task-proof` in proof requirements, missing or non-passing
AOR operator browser-task evidence is a factual run-health blocker, not an outcome-quality verdict:
- `failure_summary.owner: operator`
- `failure_summary.phase: ui_validation`
- `failure_summary.class: guided_browser_task_proof_missing`

The runner should still preserve deterministic app-smoke refs in `frontend_interactions[]`; `aor app --smoke` remains a
render guardrail and does not satisfy required browser-task proof by itself.

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
Provider qualification and run acceptance should use run-health and factual run summary status. They must not depend on code/artifact/UI quality assessment, which is advisory post-run outcome analysis.
