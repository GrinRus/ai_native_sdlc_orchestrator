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

Optional manual-only coverage lives under `manual_matrix_cells`. These cells are
visible matrix entries for operator-run rehearsals, but they never close
required acceptance coverage and must not be consumed by the qualification loop.

## Feature mission expectations
Each mission should carry:
- `mission_id`
- `title`
- `brief`
- `feature_size`
- `supported_scenarios`
- `recommended_provider_variants`
- `expected_evidence`
- `quality_evidence`
- `acceptance_checks`
- `change_evidence.required_path_prefixes` when the mission needs source-change evidence tied to specific repository surfaces
- `size_budget`
- `size_rationale`

Medium, large, and xlarge missions must also carry enough acceptance intent for
a release-quality live E2E run:
- `goals`
- `kpis`
- `definition_of_done`
- `post_run_quality.primary_commands`

Small regression missions may omit those fields when the bounded command gate is
otherwise explicit, but the runner reports medium/large/xlarge omissions as
failed artifact quality and does not close required matrix acceptance.

Missions must not use `allowed_paths` or `forbidden_paths` as Runtime Harness or live E2E acceptance gates. `change_evidence.required_path_prefixes` is narrower: it declares the minimum repository surfaces that can prove mission-relevant real-code-change evidence for `real_code_change_status`. It does not forbid other reviewed changes, but scratch files, provider-local state, editor backups, and unrelated root artifacts do not satisfy a mission that requires changes under source, test, or public type surfaces. The catalog describes expected behavior, verification commands, quality evidence, feature size, and risks; final implementation quality is judged from the target result, skill-agent operator assessment, review, delivery, and post-run verification evidence.

## Verification policy
Catalog target `verification` keeps the existing command shape:
- `setup_commands` are readiness commands. Failure means the target cannot be prepared safely.
- `commands` are target quality checks. They remain the full target diagnostic signal unless a mission declares a narrower post-run gate.
- Persistent setup artifacts needed by later verification should live under the
  profile runtime root, normally `.aor/`, so readiness tooling does not pollute
  target source-change evidence.

Feature missions may add `post_run_quality`:
- `primary_commands` are the deterministic mission-blocking post-run quality gate for that mission.
- `diagnostic_commands` are additional evidence. A failing diagnostic command is reported with `diagnostic_failure_mode` (`warn` by default) and must not hide a passing primary gate.
- If `post_run_quality` is omitted, `verification.commands` remain the primary post-run gate.

For strict quality closure, catalog missions should make warning-clean command
output part of the Definition of Done when the target ecosystem can emit
runtime warnings while returning exit code 0. The provider-facing execution
contract treats warning tokens such as Python `ResourceWarning` and
`DeprecationWarning` as failures for all-pass assessment unless the same command
and warning are proven pre-existing on an unchanged baseline.

Profiles may add `verification.baseline_gate.mode`:
- `diagnostic` records pre-provider target verification as baseline context and allows provider execution when setup, validation, routed dry-run, adapter readiness, and no-write safety gates pass.
- `blocking` treats any failed baseline verification command as a pre-execution blocker.

Default mode:
- `full-journey` profiles default to `diagnostic` because they are black-box SDLC lifecycle tests. Pre-run target failures are reported as context, while post-run verification, Runtime Harness, review, delivery, and learning are factual evidence for the separate quality assessment.
- bounded rehearsal profiles default to `blocking` because their purpose is fast pre-execution readiness proof.

Full-journey reports must distinguish:
- `baseline_verify_summary_file`, `baseline_verify_status`, and `baseline_verify_gate_decision`
- `post_run_verify_summary_file` and `post_run_verify_status`
- `post_run_diagnostic_verify_summary_file` and `post_run_diagnostic_status` when mission diagnostics are configured
- `provider_execution_status`, `real_code_change_status`, `run_start_runtime_harness_decision`, and `latest_runtime_harness_decision`

`provider_execution_status=pass` requires materialized adapter raw execution evidence, not just provider route traceability. `real_code_change_status=pass` requires meaningful changed paths after setup baseline. When the selected mission declares `change_evidence.required_path_prefixes`, at least one meaningful changed path must match one of those prefixes. Backup/editor artifacts, provider-owned runner state, scratch files, unrelated root artifacts, and `.aor/` runtime artifacts are not valid real-code-change evidence.

Run summaries must link `live_e2e_run_health_report_file` and carry
`live_e2e_run_health_overall_status`. Run-health is separate from outcome
quality and records lifecycle completion, command/controller/provider/target
environment gaps, evidence gaps, resume/interaction issues, and primary
failure owner/phase/class.

Target scorecards should mirror factual run-health refs and key evidence refs
so operators can inspect either artifact without losing run-health context.
Outcome quality is reported only by `live-e2e-quality-assessment-report`.

`exit_code=0` from a public CLI command is not sufficient for target quality:
when the referenced verify summary is `failed`, `target_verification_status`
must be `fail` even if the command transcript itself is parseable.
Conversely, a non-zero command that the runner explicitly accepts with a
readable payload is still technical command evidence; its quality impact belongs
under delivery, release, verification, or artifact-quality status.

## Notes
- The catalog is curated, not cartesian-complete.
- Every curated repo should expose at least one `small`, one `medium`, and one `large` mission.
- `xlarge` is reserved for manual or overnight rehearsals and must not be required coverage.
- `xl` is a legacy alias for `xlarge`; new catalog entries must use `xlarge`.
- Cells with `coverage_tier=required` are the canonical acceptance subset for that repo. Historical `required_matrix_cells` entries with `coverage_tier=extended` are tracked candidate cells and must not count as mandatory acceptance coverage.
