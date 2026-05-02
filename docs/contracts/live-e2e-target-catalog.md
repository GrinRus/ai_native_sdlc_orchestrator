# Live E2E target catalog

## Purpose
Machine-readable internal catalog document that binds one curated repository to its live E2E missions, required matrix cells, and provider comparison expectations.

## Required fields
- `catalog_id`
- `repo`
- `verification`
- `safety_defaults`
- `required_matrix_cells`
- `provider_comparison_pairs`
- `feature_missions`

## Feature mission expectations
Each mission should carry:
- `mission_id`
- `title`
- `brief`
- `feature_size`
- `supported_scenarios`
- `recommended_provider_variants`
- `allowed_paths`
- `forbidden_paths`
- `expected_evidence`
- `acceptance_checks`
- `size_budget`
- `size_rationale`

## Verification policy
Catalog target `verification` keeps the existing command shape:
- `setup_commands` are readiness commands. Failure means the target cannot be prepared safely.
- `commands` are target quality checks. They remain the primary deterministic regression signal for the target.

Feature missions may add `post_run_quality`:
- `primary_commands` are the deterministic post-run quality gate for that mission.
- `diagnostic_commands` are additional evidence. A failing diagnostic command is reported with `diagnostic_failure_mode` (`warn` by default) and must not hide a passing primary gate.
- If `post_run_quality` is omitted, `verification.commands` remain the primary post-run gate.

Profiles may add `verification.baseline_gate.mode`:
- `diagnostic` records pre-provider target verification as baseline context and allows provider execution when setup, validation, routed dry-run, adapter readiness, and no-write safety gates pass.
- `blocking` treats any failed baseline verification command as a pre-execution blocker.

Default mode:
- `full-journey` profiles default to `diagnostic` because they are black-box SDLC quality tests. Pre-run target failures are reported as context, while post-run verification, Runtime Harness, review, delivery, and learning decide the final quality verdict.
- bounded rehearsal profiles default to `blocking` because their purpose is fast pre-execution readiness proof.

Full-journey reports must distinguish:
- `baseline_verify_summary_file`, `baseline_verify_status`, and `baseline_verify_gate_decision`
- `post_run_verify_summary_file` and `post_run_verify_status`
- `post_run_diagnostic_verify_summary_file` and `post_run_diagnostic_status` when mission diagnostics are configured
- `provider_execution_status`, `real_code_change_status`, `run_start_runtime_harness_decision`, `latest_runtime_harness_decision`, and `quality_gate_decision`

`provider_execution_status=pass` requires materialized adapter raw execution evidence, not just provider route traceability. `real_code_change_status=pass` requires meaningful mission-scoped changed paths; backup/editor artifacts are not valid real-code-change evidence.

## Notes
- The catalog is curated, not cartesian-complete.
- Every curated repo should expose at least one `small`, one `medium`, and one `large` mission.
- Required matrix cells are the canonical acceptance subset for that repo.
