# Runbook: live E2E standard runner

## Purpose
Provide one internal black-box harness for both live E2E layers:
- bounded rehearsal profiles for fast regression and release smoke;
- catalog-backed full-journey profiles for mandatory installed-user acceptance on curated repositories and curated feature missions.

W14 extends the full-journey layer into a curated matrix across:
- `scenario_family`
- `provider_variant_id`
- `feature_size`

## Canonical profiles
Use only `scripts/live-e2e/profiles/**`.

Bounded rehearsal profiles:
- `regress-short.yaml`
- `regress-long.yaml`
- `release-short.yaml`
- `release-long.yaml`
- `w7-governance-integration.yaml`

Catalog-backed full-journey profiles:
- `full-journey-regress-ky.yaml`
- `full-journey-regress-ky-anthropic.yaml`
- `full-journey-regress-ky-medium-anthropic.yaml`
- `full-journey-release-ky-medium-openai.yaml`
- `full-journey-regress-httpie.yaml`
- `full-journey-regress-httpie-anthropic.yaml`
- `full-journey-repair-httpie-medium-anthropic.yaml`
- `full-journey-governance-httpie-medium-openai.yaml`
- `full-journey-release-nextjs.yaml`
- `full-journey-release-nextjs-anthropic.yaml`
- `full-journey-repair-nextjs-medium-anthropic.yaml`
- `full-journey-governance-nextjs-large-openai.yaml`

The human catalog stays in `docs/ops/live-e2e-target-catalog.md`; machine-readable matrix definitions live under:
- `scripts/live-e2e/catalog/targets/*.yaml`
- `scripts/live-e2e/catalog/scenarios/*.yaml`
- `scripts/live-e2e/catalog/providers/*.yaml`

## Start
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml
```

Optional override for local catalog experiments:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --catalog-root ./scripts/live-e2e/catalog
```

Bootstrap asset override for deterministic proof or fixture-driven rehearsal only:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-regress-ky.yaml \
  --examples-root ./examples
```

For full-journey acceptance, packaged bootstrap assets are used by default. `--examples-root` is an explicit internal override for proof generation and deterministic fixture-backed runs.

Expected output includes:
- `run_id`
- `live_e2e_run_summary_file`
- `live_e2e_scorecard_files`

## Layer behavior
Bounded rehearsal layer:
- clones the target checkout;
- materializes run-scoped bootstrap assets and generated project profile under harness control;
- proves one bounded black-box execution path quickly.

Full-journey layer:
- resolves `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id` from the curated internal catalog;
- uses public `aor project init --materialize-project-profile --materialize-bootstrap-assets` plus repo command overrides derived from the curated catalog;
- has the runner prepare one structured feature request input;
- materializes provider-pinned route overrides for the selected provider variant before execution starts;
- runs the public lifecycle through `intake create`, `project analyze`, `project validate`, `project verify --routed-dry-run-step implement`, `discovery run`, `spec build`, `wave create`, `handoff approve`, `project validate --require-approved-handoff`, `run start`, `run status`, `review run`, `eval run`, optional `harness certify`, `deliver prepare`, optional `release prepare`, `audit runs`, conditional incident handling, and `learning handoff`.

No harness-side `examples/context/project profile` injection is allowed on the full-journey path.

## Inspect
The harness is a one-shot command. Inspect `live_e2e_run_summary_file` directly:
- read `status`, `stage_results`, and `command_results`;
- inspect `artifacts.routed_step_result_file`, `artifacts.review_report_file`, delivery/release artifacts, and public closure artifacts when present;
- inspect `artifacts.verdict_matrix` for the final operator verdict dimensions.

Full-journey summaries must carry:
- `feature_request_file`
- `intake_artifact_packet_file`
- `review_report_file`
- `learning_loop_scorecard_file`
- `learning_loop_handoff_file`
- `verdict_matrix`

Bounded summaries continue to carry:
- `target_checkout_root`
- `generated_project_profile_file`
- `routed_step_result_file`
- `compiled_context_ref`
- `adapter_raw_evidence_ref`

## Verdict matrix
Full-journey summaries include one verdict matrix with:
- `scenario_family`
- `provider_variant_id`
- `feature_size`
- `target_selection`
- `feature_request_quality`
- `discovery_quality`
- `runtime_success`
- `artifact_quality`
- `code_quality`
- `provider_execution_status`
- `feature_size_fit_status`
- `scenario_coverage_status`
- `delivery_release_quality`
- `learning_loop_closure`
- `overall_verdict`

`overall_verdict=pass` requires successful runtime, `review-report=pass`, and public learning closure artifacts.

## Operator checks
- Summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- Full-journey runs resolve repo and mission from the curated catalog; they must not rely on raw `repo_url` plus free-form objective text.
- Full-journey runs resolve one explicit matrix cell and preserve `matrix_cell` plus `coverage_follow_up` in summary, review, audit, and learning artifacts.
- Full-journey runs use public `project init` outputs (`materialized_project_profile_file`, `materialized_bootstrap_assets_root`) rather than harness-generated profile injection.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `review_report_file` exists and is contract-valid.
- `review-report.provider_traceability` matches the requested provider variant and adapter path.
- `review-report.feature_size_fit` stays inside the declared size budget for the mission.
- `learning_loop_scorecard_file` and `learning_loop_handoff_file` exist and are contract-valid.
- Release-shaped runs keep `delivery_manifest_file` and `release_packet_file` anchored to the target checkout.
- Harness execution stays CLI-only and remains valid with web UI detached.

## W14-S07 matrix proof bundle (2026-04-24)
Observed curated runs:
- `w14-s07.full-journey-regress-ky`, `w14-s07.full-journey-regress-ky-anthropic`, `w14-s07.full-journey-regress-ky-medium-anthropic-rerun`, and `w14-s07.full-journey-release-ky-medium-openai` cover all required `ky` cells.
- `w14-s07.full-journey-regress-httpie`, `w14-s07.full-journey-regress-httpie-anthropic`, `w14-s07.full-journey-repair-httpie-medium-anthropic`, and `w14-s07.full-journey-governance-httpie-medium-openai` cover all required `httpie/cli` cells plus the repo-level provider-comparison pair.
- `w14-s07.full-journey-release-nextjs`, `w14-s07.full-journey-release-nextjs-anthropic`, `w14-s07.full-journey-repair-nextjs-medium-anthropic`, and `w14-s07.full-journey-governance-nextjs-large-openai` cover all required `belgattitude/nextjs-monorepo-example` cells plus the repo-level provider-comparison pair.

Canonical fixtures:
- `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json`
- `examples/live-e2e/fixtures/w14-s07/`

Evidence note:
- the committed bundle preserves catalog-backed repo and mission resolution, scenario/provider/size matrix-cell validation, provider-pinned route overrides, public `project init`, mission-generated intake/discovery/spec/handoff artifacts, public `review run`, public `audit runs`, and public `learning handoff` closure artifacts.
- the bundle proves all `9/9` repo-level required matrix cells and all `3/3` catalog provider-comparison pairs across `ky`, `httpie/cli`, and `nextjs-monorepo-example`.
- the bundle proves all mandatory scenario families: `regress`, `release`, `repair`, and `governance`.
- `overall_verdict` remains `pass_with_findings` in the committed proof because the deterministic external runner mock does not materialize mission code changes, leaving `review-report.code_quality=warn`.
