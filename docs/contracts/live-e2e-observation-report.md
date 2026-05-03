# Live E2E observation report

## Purpose
Black-box operator report for one live E2E run.

The report records whether the public AOR user flow reached delivery, what each public step produced, how an operator or agent judged the step artifacts, and what code-quality evidence was observed after delivery. It is an observation artifact, not a strict acceptance gate for the implementation produced by AOR.

## Required fields
- `report_id`
- `run_id`
- `profile_id`
- `flow_range`
- `overall_status`
- `step_matrix`
- `artifact_quality_matrix`
- `code_quality_after_delivery`
- `continuation_decisions`
- `evidence_refs`

## Status semantics
`overall_status` and matrix entry statuses must use:
- `pass`
- `warn`
- `not_pass`

`not_pass` means the black-box flow could not reach delivery or delivery evidence was not materialized. Code quality failures, no-op implementation, failed post-delivery checks, weak artifacts, and judge findings should downgrade to `warn` when delivery evidence still exists.

## Section expectations
`flow_range` should preserve:
- `start_step`
- `end_step`
- `included_steps`
- `prelude_steps`
- `excluded_steps`

`step_matrix[]` should preserve:
- `step`
- `status`
- `command_label`
- `command_surface`
- `artifact_refs`
- `findings`

`artifact_quality_matrix[]` should preserve:
- `step`
- `status`
- `judge_source`
- `artifact_refs`
- `findings`

`code_quality_after_delivery` should preserve:
- `status`
- `delivery_manifest_ref`
- `review_report_ref`
- `post_delivery_check_refs`
- `changed_paths`
- `findings`

`continuation_decisions[]` should preserve:
- `step`
- `decision`
- `reason`
- `next_step`

## Notes
Artifact quality may be judged by the agent or operator running the live E2E flow. When no judge file is provided, the runner should still materialize this report with controlled `warn` artifact-quality entries and a finding such as `agent-judge-not-provided`.
