# Live E2E observation report

## Purpose
Factual black-box step journal for one live E2E run.

The observation report records what the installed-user live E2E controller did through public CLI/API/web surfaces. It is not a quality oracle for the produced code, artifacts, or UX. Outcome-oriented judgement belongs in a separate `live-e2e-quality-assessment-report`; run failures and gaps in the run itself belong in `live-e2e-run-health-report`.

This contract is intentionally breaking. Producers must not emit the old result-quality aggregation fields:
- `quality_judgement`
- `runner_quality_summary`
- `final_skill_agent_verdict_request_file`
- `final_skill_agent_verdict_file`
- `final_skill_agent_verdict`
- `agent_artifact_review_request_file`
- `canonical_status`
- `artifact_quality_status`
- `delivery_status`
- `coverage_status`
- `acceptance_status`

Legacy `step_matrix`, `verdict_matrix`, `artifact_quality_matrix`, `code_quality_after_delivery`, and synthetic `continuation_decisions` remain forbidden.

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
- `setup_journal`
- `step_journal`
- `final_analysis`
- `interactive_decisions`
- `frontend_interactions`
- `evidence_refs`

## Status semantics
`overall_status`, `final_analysis.status`, and step-level statuses use:
- `pass`
- `warn`
- `not_pass`
- `blocked`
- `interaction_required`
- `resumed`

These statuses describe the factual live E2E run and controller flow. They do not certify implementation correctness, artifact content quality, security, performance, accessibility, or product UX.

`report_status` is `final` or `in_progress`. `in_progress` is only for resumable controller artifacts waiting for a step-level public action or operator decision.

## Section expectations
`flow_range` preserves:
- `start_step`
- `end_step`
- `included_steps`
- `prelude_steps`
- `excluded_steps`

`flow_range_policy` is one of:
- `delivery_default`
- `full_lifecycle`

`aor_installation` preserves install/source-channel proof, source roots, runtime roots, launcher refs, and command transcripts.

`setup_journal[]` preserves installed-user prelude evidence:
- `install`
- `target_checkout`
- `project_bootstrap`
- `intake`
- `readiness`

Readiness entries may include target setup and target verification details. These fields must separate owner and phase for run-health classification:
- `target_setup_status`
- `target_verification_status`
- `failure_owner` (`aor|target_repository|provider|environment|operator`)
- `failure_phase`
- `failure_class`

Observation reports may also expose a top-level `target_readiness` block so
consumers do not have to reconstruct pre-execution state from setup-journal
entries. This block is factual run evidence only. It should preserve:
- `phase: target_readiness`
- `status`
- target toolchain, setup, and verification statuses
- target toolchain preflight, pre-execution status, baseline verification, and
  execution-readiness refs
- failure owner/phase/class when readiness blocks before product execution
- whether product execution had started

`step_journal[]` preserves the public-step controller evidence:
- plan and `plan_ref`
- public surface and command transcript refs
- execution, inspection, and classification refs
- materialized artifact refs
- deterministic analysis
- semantic analysis from the live E2E operator for step continuation only
- agent decision request refs
- operator decision refs and statuses
- inspected evidence refs
- requested interaction and resume result
- frontend interaction refs
- final step verdict

Step-level operator decisions are control-flow evidence only. They decide whether the next public step may run; they are not the final outcome-quality judgement.

`frontend_interactions[]` preserves factual AOR operator UI/browser evidence refs:
- rendered HTML
- screenshot or visual guardrail refs
- browser-task proof refs
- DOM snapshot
- accessibility summary
- structured AOR operator accessibility checks
- AOR operator task outcome
- AOR operator UX findings captured during the run
- optional operator decision refs from guided browser-task proof flows

These are factual evidence refs. AOR operator UI/UX quality, accessibility depth, visual responsiveness, and installed-user usability are assessed in `live-e2e-quality-assessment-report`.
When browser-task proof is produced after the deterministic smoke summary, final
report assembly should hydrate `frontend_interactions[]` from the proof file so
the observation links the proof ref, screenshot refs, structured accessibility
checks, and task outcome.

`guided_ui_evidence` may summarize the same factual refs for consumers that do
not want to traverse `frontend_interactions[]`. For browser-task guided
profiles it should include whether proof is required, proof status, web-smoke
refs, browser-task request/proof refs, screenshot refs, keyboard focus
sequence, structured accessibility checks, weak evidence refs, and all
supporting evidence refs. This section is still factual run evidence, not a UI
or accessibility quality judgement.

`frontend_interactions[].accessibility_checks[]` must include one entry for each
AOR operator accessibility check:
- `keyboard_navigation`
- `focus_order`
- `contrast_and_readability`
- `semantic_structure`
- `screen_reader_labels`
- `accessible_error_feedback`

Each check is factual evidence only and must include `check_id`, `status`,
`evidence_refs[]`, and `findings[]`.

`final_analysis` preserves factual run closure:
- `status`
- `summary`
- `findings`
- `failed_stages`
- `delivery`
- `release`
- `learning`

For a declared full lifecycle, `final_analysis.status` must not be `pass` while
any included public step is missing an accepted operator decision. Missing
included steps should be reported as blocked factual controller evidence so
run-health can classify the incomplete lifecycle before product-quality
assessment is attempted.

`final_analysis` must not contain `code_quality`, `artifact_quality`, `quality_judgement`, or `runner_quality_summary`.

## Notes
The observation report is not a post-run reconstruction. The controller must persist each step observation after `plan -> execute -> inspect -> classify -> decide -> persist`, before the next public step executes.

Run-health consumers should inspect this report plus the run summary to produce `live-e2e-run-health-report`.

The SWE agent that launched the check should inspect this report, run-health, and all linked evidence to produce `live-e2e-quality-assessment-report` after the full flow.
