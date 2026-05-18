# Live E2E observation report

## Purpose
Black-box step journal for one live E2E run.

The report records each public CLI/API/web step as an ordered observation written by the online step controller. Each entry carries the step plan, transcript, materialized artifact refs, deterministic command analysis, semantic operator/agent analysis, interactive decisions, resume results, and the final step verdict.

This contract intentionally replaces the legacy post-run `step_matrix`, `artifact_quality_matrix`, and synthetic `continuation_decisions` model. Producers must not emit those fields.

## Required fields
- `report_id`
- `run_id`
- `profile_id`
- `controller_state_ref`
- `flow_range`
- `flow_range_policy`
- `overall_status`
- `step_journal`
- `final_analysis`
- `interactive_decisions`
- `frontend_interactions`
- `evidence_refs`

## Status semantics
`overall_status`, `final_analysis.status`, and step-level statuses must use:
- `pass`
- `warn`
- `not_pass`
- `blocked`
- `interaction_required`
- `resumed`

`not_pass` is terminal for a failed black-box flow. Delivery evidence no longer downgrades failures to `warn`.

`interaction_required` means the public step produced a persisted `requested_interaction` that has not yet been answered.

`resumed` means an operator/agent answer was accepted and the runtime resumed from the recorded checkpoint.

## Section expectations
`flow_range` should preserve:
- `start_step`
- `end_step`
- `included_steps`
- `prelude_steps`
- `excluded_steps`

`flow_range_policy` must be one of:
- `delivery_default`
- `full_lifecycle`

`step_journal[]` should preserve:
- `sequence`
- `step_id`
- `flow_stage`
- `plan`
- `public_surface`
- `transcript_ref`
- `artifact_refs`
- `started_at`
- `finished_at`
- `duration_sec`
- `deterministic_analysis`
- `semantic_analysis`
- `requested_interaction`
- `decision`
- `resume_result`
- `frontend_interaction_refs`
- `final_step_verdict`

`plan` should preserve:
- `objective`
- `public_surface`
- `command_labels`
- `expected_artifacts`
- `inspection_sources`
- `safety_constraints`

`deterministic_analysis` should preserve:
- `status`
- `exit_code`
- `failure_class`
- `missing_evidence`
- `recommendation`

`semantic_analysis` should preserve:
- `status`
- `judge_source`
- `findings`

`interactive_decisions[]` should preserve:
- `step_id`
- `decision`
- `reason`
- `answer_audit_refs`
- `resume_result`
- `next_step`

`frontend_interactions[]` should preserve:
- `step_id`
- `surface`
- `evidence_refs`
- `status`
- `summary`

`final_analysis` should preserve:
- `status`
- `summary`
- `findings`
- `code_quality`
- `delivery`
- `release`
- `learning`

## Notes
Artifact quality may be judged by the live E2E skill or by the operator running the flow. If no external judge file is supplied, the runner must still write deterministic semantic analysis from public transcripts and artifacts; it must not emit a legacy missing-judge matrix.

The journal is not a post-run reconstruction. The controller must persist the step observation and `controller_state_ref` after `plan -> execute -> inspect -> classify -> decide -> persist`, before the next public step is allowed to execute.
