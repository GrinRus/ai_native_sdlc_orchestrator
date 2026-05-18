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

Medium, large, and xl missions must also carry enough acceptance intent for a
release-quality live E2E run:
- `goals`
- `kpis`
- `definition_of_done`
- `post_run_quality.primary_commands`

Small regression missions may omit those fields when the bounded command gate is
otherwise explicit, but the runner reports medium+ omissions as failed artifact
quality and does not close required matrix acceptance.

## Verification policy
Catalog target `verification` keeps the existing command shape:
- `setup_commands` are readiness commands. Failure means the target cannot be prepared safely.
- `commands` are target quality checks. They remain the full target diagnostic signal unless a mission declares a narrower post-run gate.

Feature missions may add `post_run_quality`:
- `primary_commands` are the deterministic mission-blocking post-run quality gate for that mission.
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

Run summaries must also carry a canonical status block that is separate from the
legacy `verdict_matrix`:
- `command_status`: public AOR subprocesses completed and emitted readable payloads.
- `target_verification_status`: post-run primary target verification result.
- `artifact_quality_status`: intake, lineage, review, and artifact consistency result.
- `delivery_status`: `materialized`, `degraded`, `blocked`, or `not_materialized`.
- `coverage_status`: `covered_pass`, `covered_with_findings`, `attempted_failed`, or `not_attempted`.
- `acceptance_status`: `pass`, `warn`, or `fail`; `warn` never closes required matrix acceptance.
- `run_tier`: `readme-smoke`, `bounded-live`, `full-journey-observation`, `acceptance`, or `production-proof`.
- `release_status`: `pass`, `fail`, `skipped`, or `not_attempted`.
- `proof_eligible_tier`: whether `run_tier` can close required matrix coverage.
- `required_matrix_acceptance_closed`: true only for `covered_pass` on an eligible run tier.

Target scorecards should mirror the canonical status block so operators can
inspect either artifact without losing the acceptance decision.

`exit_code=0` from a public CLI command is not sufficient for target quality:
when the referenced verify summary is `failed`, `target_verification_status`
must be `fail` even if the command transcript itself is parseable.
Conversely, a non-zero command that the runner explicitly accepts with a
readable payload is still technical command evidence; its quality impact belongs
under delivery, release, verification, or artifact-quality status.

## Notes
- The catalog is curated, not cartesian-complete.
- Every curated repo should expose at least one `small`, one `medium`, and one `large` mission.
- `xl` is reserved for manual or overnight rehearsals and must not be required coverage.
- Cells with `coverage_tier=required` are the canonical acceptance subset for that repo. Historical `required_matrix_cells` entries with `coverage_tier=extended` are tracked candidate cells and must not count as mandatory acceptance coverage.
