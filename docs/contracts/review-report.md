# Review report

## Purpose
Durable report-only quality verdict for one run after execution evidence, delivery lineage, and feature-mission traceability have been materialized.

## Required fields
- `review_report_id`
- `project_id`
- `run_id`
- `generated_at`
- `overall_status`
- `review_recommendation`
- `feature_traceability`
- `discovery_quality`
- `artifact_quality`
- `code_quality`
- `findings`
- `evidence_refs`

## Status and recommendation semantics
`overall_status` must use:
- `pass`
- `warn`
- `fail`

`review_recommendation` must use:
- `proceed`
- `repair`
- `required-human-review`

## Section expectations
`feature_traceability` should preserve:
- `status`
- `mission_id`
- `input_packet_ref`
- `request_title`
- `request_brief`

`discovery_quality` should preserve:
- `status`
- `analysis_report_ref`
- `spec_step_result_ref`
- `handoff_packet_ref`
- `findings`

`artifact_quality` should preserve:
- `status`
- `verify_summary_ref`
- `execution_step_result_refs`
- `delivery_manifest_ref`
- `release_packet_ref`
- `findings`

`code_quality` should preserve:
- `status`
- `changed_paths`
- `allowed_paths`
- `forbidden_paths`
- `findings`

Each finding should keep:
- `finding_id`
- `severity`
- `category`
- `summary`
- `evidence_refs`

## Notes
`review-report` is report-only. A failing review must remain machine-readable without forcing command failure unless the CLI itself encounters usage, runtime, or contract-resolution errors.
