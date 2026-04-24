# Runbook: live E2E standard runner

## Purpose
Provide one internal black-box harness for both live E2E layers:
- bounded rehearsal profiles for fast regression and release smoke;
- catalog-backed full-journey profiles for mandatory installed-user acceptance on curated repositories and curated feature missions.

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
- `full-journey-regress-httpie.yaml`
- `full-journey-release-nextjs.yaml`

The human catalog stays in `docs/ops/live-e2e-target-catalog.md`; machine-readable target and mission definitions live under `scripts/live-e2e/catalog/targets/*.yaml`.

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
- resolves `target_catalog_id` and `feature_mission_id` from the curated internal catalog;
- uses public `aor project init --materialize-project-profile --materialize-bootstrap-assets` plus repo command overrides derived from the curated catalog;
- has the runner prepare one structured feature request input;
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
- `target_selection`
- `feature_request_quality`
- `discovery_quality`
- `runtime_success`
- `artifact_quality`
- `code_quality`
- `delivery_release_quality`
- `learning_loop_closure`
- `overall_verdict`

`overall_verdict=pass` requires successful runtime, `review-report=pass`, and public learning closure artifacts.

## Operator checks
- Summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- Full-journey runs resolve repo and mission from the curated catalog; they must not rely on raw `repo_url` plus free-form objective text.
- Full-journey runs use public `project init` outputs (`materialized_project_profile_file`, `materialized_bootstrap_assets_root`) rather than harness-generated profile injection.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `review_report_file` exists and is contract-valid.
- `learning_loop_scorecard_file` and `learning_loop_handoff_file` exist and are contract-valid.
- Release-shaped runs keep `delivery_manifest_file` and `release_packet_file` anchored to the target checkout.
- Harness execution stays CLI-only and remains valid with web UI detached.

## W13-S06 full-journey proof bundle (2026-04-24)
Observed curated runs:
- `w13-s06.full-journey-regress-ky` on `sindresorhus/ky` mission `ky-header-regression` with harness status `pass` and `overall_verdict=pass_with_findings`
- `w13-s06.full-journey-regress-httpie` on `httpie/cli` mission `httpie-cli-output-regression` with harness status `pass` and `overall_verdict=pass_with_findings`
- `w13-s06.full-journey-release-nextjs` on `belgattitude/nextjs-monorepo-example` mission `nextjs-shared-package-release` with harness status `pass` and `overall_verdict=pass_with_findings`

Canonical fixtures:
- `examples/live-e2e/fixtures/w13-s06/w13-s06-evidence-bundle.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-regress-ky.run-summary.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-regress-httpie.run-summary.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-release-nextjs.run-summary.json`

Evidence note:
- the committed bundle preserves catalog-backed repo and mission resolution, public `project init` bootstrap with repo command overrides, mission-generated intake/discovery/spec/handoff artifacts, public `review run`, and public `audit runs` plus `learning handoff` closure artifacts.
- `overall_verdict` remains `pass_with_findings` in the committed proof because the deterministic external runner mock does not materialize mission code changes, leaving `review-report.code_quality=warn`.
