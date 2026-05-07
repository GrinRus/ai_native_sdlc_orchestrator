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
- `feature_size_fit`
- `provider_traceability`
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
- `scenario_family`
- `provider_variant_id`
- `feature_size`
- `matrix_cell`
- `coverage_follow_up`

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

For test files, `code_quality.findings` should flag likely coverage weakening, including lowered `t.plan(...)` counts or removed assertions without an equivalent replacement. Source-tree backup or editor artifacts such as `.bak`, `.orig`, `.rej`, `.tmp`, `.swp`, and `~` files should also be flagged because they are not valid implementation deliverables. These findings are review signals; they do not replace deterministic post-run verification.

`feature_size_fit` should preserve:
- `status`
- `feature_size`
- `size_budget`
- `actual_change`
- `findings`

`provider_traceability` should preserve:
- `status`
- `provider_variant_id`
- `requested_provider`
- `requested_adapter`
- `actual_provider`
- `actual_adapter`
- `route_id`
- `route_profile_source`
- `findings`

Each finding should keep:
- `finding_id`
- `severity`
- `category`
- `summary`
- `evidence_refs`

## Loader validation
The shared contract loader validates the nested review report shape used by CLI/API/runtime readers:
- section `status` fields must use `pass|warn|fail` when present; legacy read-model fixtures may keep empty section objects;
- path and evidence arrays must contain strings;
- nested `matrix_cell` values validate known identity, scenario, and provider fields when those fields are present;
- nested `coverage_follow_up` validates `current_cell_required` and next/remaining matrix cells when those fields are present; legacy non-catalog outputs may keep an empty object;
- optional provider traceability fields may be strings or `null` when the upstream runtime evidence was intentionally missing or blocked;
- each finding must be an object with `finding_id`, `severity`, `category`, `summary`, and `evidence_refs[]`.

## Notes
`review-report` is report-only. A failing review must remain machine-readable without forcing command failure unless the CLI itself encounters usage, runtime, or contract-resolution errors.

For strict code-changing missions, no non-bootstrap changed paths is a `fail` code-quality finding. Docs-only and no-write rehearsal flows may use softer strictness profiles, but that softness belongs to mission/runtime policy rather than the review report hiding a code-changing no-op.
