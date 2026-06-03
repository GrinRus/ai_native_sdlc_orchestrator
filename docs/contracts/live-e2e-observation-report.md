# Live E2E observation report

## Purpose
Black-box step journal for one live E2E run.

The report records each public CLI/API/web step as an ordered observation written by the online step controller. Each entry carries the step plan, transcript, materialized artifact refs, deterministic command analysis, semantic operator/agent analysis, interactive decisions, resume results, and the final step verdict.

Before the SDLC journal starts, the report must also preserve installed-user setup evidence. AOR installation/source-channel proof, target checkout, project bootstrap, intake, and readiness are setup/prelude observations, not SDLC step verdicts.

This contract intentionally replaces the legacy post-run `step_matrix`, `verdict_matrix`, `artifact_quality_matrix`, and synthetic `continuation_decisions` model. Producers must not emit those fields.

## Required fields
- `report_id`
- `run_id`
- `profile_id`
- `operator_context`
- `report_status`
- `controller_state_ref`
- `flow_range`
- `flow_range_policy`
- `overall_status`
- `aor_installation`
- `aor_installation_proof_file`
- `final_skill_agent_verdict_request_file`
- `setup_journal`
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

`aor_installation` should preserve:
- `status`
- `declared_policy`
- `effective_policy`
- `install_mode`
- `source_channel`
- `workspace_root`
- `runtime_root`
- `original_source_root`
- `installed_source_root`
- `launcher_ref`
- `command_transcripts`

`setup_journal[]` should preserve:
- `sequence`
- `step_id`
- `status`
- `public_surface`
- `evidence_refs`
- `summary`

The `readiness` setup entry may also include target setup and verification
status details. These details must separate AOR runner/controller failures from
target repository failures:
- `target_setup_status`
- `target_verification_status`
- `failure_owner` (`aor|target_repository|provider|environment|operator`)
- `failure_phase`
  (`aor_install|target_checkout|target_setup|target_verification|provider_execution|controller_decision|ui_validation`)
- `failure_class`

Target repository setup, test, build, browser dependency, or timeout blockers
are valid fail-closed evidence, but they are not provider-quality signals and
must not be reported as AOR product passes.

`flow_range_policy` must be one of:
- `delivery_default`
- `full_lifecycle`

`step_journal[]` should preserve:
- `sequence`
- `step_id`
- `step_instance_id`
- `iteration`
- `flow_stage`
- `plan`
- `plan_ref`
- `public_surface`
- `transcript_ref`
- `execution_ref`
- `inspection_ref`
- `classification_ref`
- `artifact_refs`
- `started_at`
- `finished_at`
- `duration_sec`
- `deterministic_analysis`
- `semantic_analysis`
- `agent_decision_request_ref`
- `operator_decision_ref`
- `operator_decision_status`
- `inspected_evidence_refs`
- `requested_interaction`
- `decision`
- `resume_result`
- `frontend_interaction_refs`
- `final_step_verdict`

When a step invokes an external provider, `step_journal[]` may also include
`provider_step_status`. This is the same query-safe heartbeat exposed by the
control plane and must preserve provider, adapter, route, step, status,
elapsed/budget fields, last output/artifact timestamps, command label, and
recommended action. It must not include raw process commands, command args,
environment variables, tokens, or secrets.

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
- `judge_source` (`skill-agent`)
- `findings`

`operator_context` should preserve:
- `operator_kind` (`skill-agent`)
- `operator_ref`
- `decision_policy` (`required`)
- `answer_policy` (`agent-public-control-plane`)
- `target_write_policy`

`report_status` must be `final` or `in_progress`. `in_progress` is only for resumable controller artifacts waiting for an operator decision; it is not an acceptance report and cannot close qualification.

`operator_decision_status` must be one of:
- `accepted`
- `missing`
- `rejected`

`agent_decision_request_ref` is the source of truth for preparing skill-agent
operator decisions. Each decision request must include `decision_rubric` with
`required_evidence_refs[]`, optional `frontend_evidence_refs[]`,
`operator_decision_expected_ref`, and `expected_response_shape`. A helper-
prepared operator decision must preserve:
- `request_id`
- `step_id`
- `step_instance_id`
- `iteration`
- `status` (`accepted`)
- `operator_ref`
- `action` (`continue|answer|frontend_interact|retry_public_step|diagnose|block`)
- `reason`
- `semantic_analysis.status`
- `semantic_analysis.judge_source` (`skill-agent`)
- `semantic_analysis.findings[]`
- `inspected_evidence_refs[]` copied from
  `decision_rubric.required_evidence_refs[]`
- `evidence_refs[]` including required inspected refs and any frontend refs
- `frontend_evidence_refs[]` when UI/browser proof is required
- `source_agent_decision_request_ref`
- `created_at`

Rejected decisions must keep a readable `operator_decision_rejection_reason`.
The correction path is to prepare a new draft from the same
`agent_decision_request_ref` and selected public action; operators should not
need to hand-edit raw JSON to copy required evidence refs.

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
- `html_ref`
- `screenshot_refs`
- `visual_guardrail_refs`
- `browser_task_proof_ref`
- `dom_snapshot_ref`
- `accessibility_summary_ref`
- `task_outcome`
- `ux_findings`
- `agent_verdict_ref`
- `status`
- `summary`

`final_analysis` should preserve:
- `status`
- `summary`
- `findings`
- `code_quality`
- `failed_stages`
- `delivery`
- `release`
- `learning`

`final_skill_agent_verdict_request_file` must point to the final request packet that tells the skill-agent which evidence to inspect. For `report_status=final`, `final_skill_agent_verdict_file` must point to an accepted skill-agent verdict artifact. A final acceptance/proof report requires every included `step_journal[]` entry to have `operator_decision_status=accepted`, every included step semantic analysis to have `judge_source=skill-agent`, and the final verdict artifact to have `judge_source=skill-agent` plus non-empty `inspected_evidence_refs[]`.

Profiles that declare `live_e2e.frontend_capability` other than `none` must treat `frontend_interactions[]` as first-class proof evidence. Deterministic web smoke output can establish that the installed-user web surface rendered, but final acceptance also requires browser-task proof refs, screenshot or visual-guardrail refs, and a linked skill-agent UI/UX verdict through `agent_verdict_ref`. Missing HTML, DOM snapshot, screenshot or visual guardrail, accessibility summary, failed `task_outcome`, or missing agent UI verdict blocks acceptance.

## Notes
`failed_stages[]` records deterministic stage-level failures that are inside the observed step range or setup/prelude range. Stages outside the active flow range, such as `release` or `learning` in `delivery_default` profiles, may remain outside terminal status accounting unless they are part of `step_journal[]`.

Artifact quality for live E2E proof is judged by the live E2E skill-agent through public artifacts, logs, CLI/API output, and control-plane surfaces. Deterministic runner checks remain guardrails and diagnostics; they are not valid live E2E operator evidence and cannot replace accepted skill-agent decisions.

The journal is not a post-run reconstruction. The controller must persist the step observation and `controller_state_ref` after `plan -> execute -> inspect -> classify -> decide -> persist`, before the next public step is allowed to execute.
