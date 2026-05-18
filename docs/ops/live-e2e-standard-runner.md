# Runbook: live E2E standard runner

## Purpose
Provide one installed-user black-box proof runner for both live E2E layers:
- bounded rehearsal profiles for fast regression and release smoke;
- catalog-backed full-journey profiles for mandatory installed-user acceptance on curated repositories and curated feature missions.

Live E2E simulates a user who has installed AOR, initializes or attaches a target repository, walks the public SDLC flow through CLI/API surfaces, and then emits a per-step black-box observation summary. It must not call private runtime internals to repair the run. It proves whether AOR works as a product from the public surface and whether produced artifacts explain each `pass`, `warn`, `not_pass`, block, and missing-evidence gap.

W14 extends the full-journey layer into a curated matrix across:
- `scenario_family`
- `provider_variant_id`
- `feature_size`

Current summaries also preserve `run_tier` so coverage is not confused with
acceptance proof:
- `readme-smoke`: installed-user no-write bootstrap path;
- `bounded-live`: fast fail-closed provider proof;
- `full-journey-observation`: delivery-reaching observation with findings allowed;
- `acceptance`: required matrix closure, fail-closed for artifact and verification gates;
- `production-proof`: real external process, no mock, no upstream write, strict evidence.

## Canonical profiles
Use only `scripts/live-e2e/profiles/**`.

Bounded rehearsal profiles:
- `regress-short.yaml`
- `regress-long.yaml`
- `release-short.yaml`
- `release-long.yaml`
- `w7-governance-integration.yaml`

Catalog-backed full-journey profiles:
- `installed-user-guided-journey.yaml`
- `full-journey-production-proof-ky-openai.yaml`
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

By default, live E2E uses `--runner-auth-mode host`: AOR runtime state remains isolated under `.aor/`, while external runners reuse the operator's local CLI authentication. This means `codex` uses the normal `~/.codex` or caller-provided `CODEX_HOME`, and `claude` uses the normal local Claude Code auth/config sources. Use `--runner-auth-mode isolated` only for CI, proof, or fixture runs that deliberately need a session-scoped runner home.

By default, live E2E also uses `--runtime-agent-permission-mode full-bypass` so non-interactive acceptance runs do not pause on runner-native tool approval prompts inside isolated checkouts. Use `--runtime-agent-permission-mode restricted` when diagnosing adapter-native permission behavior. The selected mode is passed to public `aor` subprocesses through `AOR_RUNTIME_AGENT_PERMISSION_MODE` and is recorded in live adapter preflight, raw adapter evidence, routed step results, and the run summary.

This is required for Claude Code because `--permission-mode auto` can ask the operator to approve tool reads or writes when the compiled context links handoff/spec artifacts under `.aor/`. AOR invokes Claude through `--print` in non-interactive live E2E, so there is no interactive approval channel to answer those prompts during the run.

Provider permission-mode analogues:
- Codex full-bypass: `--ask-for-approval never` with the configured workspace sandbox.
- Codex restricted: configured non-interactive `codex exec` args without the approval bypass.
- Claude Code full-bypass: `--dangerously-skip-permissions`.
- Claude Code restricted: `--permission-mode auto`.
- OpenCode full-bypass: `opencode run --format json --dangerously-skip-permissions`.
- OpenCode restricted: `opencode run --format json`.

Live adapter preflight uses `execution.external_runtime.preflight_timeout_ms` when present, and otherwise derives a bounded probe timeout from `execution.external_runtime.timeout_ms`. Preflight and full external runner execution are hard local subprocess bounds: a runner that exceeds them has its local process group killed and is reported as timeout evidence instead of leaving the public lifecycle waiting indefinitely. Per-step policy budgets may shorten an external runner request, but they must not extend it beyond the adapter profile timeout. If the permission-readiness marker is written with the expected nonce before the runner times out, access readiness passes with a `post-marker-timeout` warning; structured permission denials still fail even when the marker exists.

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

Production-proof candidate profile:

```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/full-journey-production-proof-ky-openai.yaml \
  --runner-auth-mode host \
  --runtime-agent-permission-mode full-bypass
```

`full-journey-production-proof-ky-openai.yaml` is stricter than the W14 coverage profiles:
- it resolves `ky` and `ky-header-regression` from the curated target catalog;
- it uses the packaged `codex-cli` adapter profile and `external_runner_mode=real-external-process`;
- it rejects `--examples-root` because production proof cannot use deterministic mock adapter injection;
- it sets `verification.baseline_gate.mode=blocking`, so target verification failures block before provider execution;
- it keeps `output_policy.write_back_to_remote=false` and `preferred_delivery_mode=patch-only`;
- it starts from candidate profile metadata, then promotes the run summary to `proof_scope=full_code_changing_runtime` and `real_code_change_proof_complete=true` only when executable evidence proves a real code-changing pass, required target verdicts pass, Runtime Harness/review/delivery evidence exists, and the no-upstream-write assertion passes.

Expected output includes:
- `run_id`
- `live_e2e_run_summary_file`
- `live_e2e_scorecard_files`

## Layer behavior
Bounded rehearsal layer:
- clones the target checkout;
- materializes run-scoped bootstrap assets and generated project profile under proof-runner control;
- proves one bounded black-box execution path quickly.

Full-journey layer:
- resolves `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id` from the curated internal catalog;
- uses public `aor project init --materialize-project-profile --materialize-bootstrap-assets` plus repo command overrides derived from the curated catalog;
- preflights the selected provider adapter before execution so missing live runtime metadata, missing commands, auth failures, edit-readiness failures, and permission-mode blocks fail before `run start`;
- records auth probe attempts and retries one transient auth/runtime probe failure before failing the proof;
- splits verification into `readiness`, `baseline_diagnostic`, and `post_run_quality` phases;
- treats full-journey baseline target verification as diagnostic by default: failed target `verification.commands` are preserved as context, but setup failures, missing prerequisites, failed validation, missing or failed routed dry-run, provider readiness failure, and unsafe write-back policy still block before execution;
- resolves mission post-run quality into a mission-blocking primary gate plus optional full diagnostic commands; a failed diagnostic command records findings without hiding a passing primary gate unless the mission declares `diagnostic_failure_mode=fail`;
- has the runner prepare one structured feature request input;
- requires medium, large, and xl catalog missions to provide goals, KPIs, Definition of Done, path bounds, expected evidence, and primary post-run commands before the run can close acceptance;
- materializes provider-pinned route overrides for the selected provider variant before execution starts;
- writes an execution-readiness decision before `run start` so promotion evidence is based on readiness and routed dry-run proof, not on a failed baseline target check;
- runs the public observation lifecycle through `intake create`, `project analyze`, `project validate`, baseline `project verify --verification-label baseline-diagnostic --routed-dry-run-step implement`, `discovery run`, `spec build`, `wave create`, `handoff approve`, `project validate --require-approved-handoff`, `run start`, `run status`, primary post-run `project verify --verification-label post-run-primary`, `review run`, `eval run`, optional diagnostic `project verify --verification-label post-run-diagnostic`, and `deliver prepare --quality-gate-mode observe`.
- runs target verification commands with inherited Node compile-cache state disabled so the orchestrator's runtime session cache cannot corrupt target package-manager or test-runner module loading.
- may still run legacy audit or learning diagnostics after delivery for compatibility, but `release` and `learning` are excluded from the v1 observation matrix.

Production-proof profiles add a fail-closed layer on top of full-journey behavior:
- runner auth probe is required;
- edit and permission readiness are required before `run start`;
- target setup and verification commands must be declared;
- baseline target verification must use blocking mode;
- write-back must remain disabled and delivery mode must be `patch-only` or `local-branch`;
- deterministic proof-runner `--examples-root` overrides are rejected.

Guided full-journey profiles set `guided_journey.enabled=true`. They still use the full-journey catalog and public CLI subprocesses, but prepend installed-user shortcuts (`doctor`, `onboard`, `app`, `next`), use `mission create` for the product intake packet, require an approved `review decide` before delivery/release, run `release prepare`, close `learning handoff`, and capture an operator-console web smoke artifact. The runner writes `installed-user-guided-journey-proof-<run>.json` and fails the run if the proof is only narrative: required CLI transcripts, packet/report files, web smoke output, and no-upstream-write assertions must be materialized.

No proof-runner-side `examples/context/project profile` injection is allowed on the full-journey path.

## Inspect
The proof runner is a one-shot command. Inspect `live_e2e_run_summary_file` directly:
- read `status`, `stage_results`, and `command_results`;
- inspect `live_e2e_observation_report_file` first; it is the durable product-flow verdict for `discovery -> delivery`;
- inspect `agent_artifact_review_request_file` when no `--agent-judge-file` was supplied;
- inspect `artifacts.routed_step_result_file`, `artifacts.review_report_file`, delivery artifacts, and public closure artifacts when present;
- inspect `artifacts.verdict_matrix` only as a legacy diagnostic matrix.

Full-journey summaries must carry:
- `target_catalog_id`
- `feature_mission_id`
- `feature_request_file`
- `intake_artifact_packet_file`
- `baseline_verify_summary_file`
- `baseline_verify_status`
- `baseline_verify_gate_decision`
- `post_run_verify_summary_file`
- `post_run_verify_status`
- `post_run_diagnostic_verify_summary_file` when configured
- `post_run_diagnostic_status`
- `real_code_change_status`
- `runtime_harness_report_file`
- `runtime_harness_decision`
- `run_start_runtime_harness_decision`
- `latest_runtime_harness_decision`
- `quality_gate_decision`
- `review_report_file`
- `live_e2e_observation_report_file`
- `live_e2e_observation_overall_status`
- `agent_artifact_review_request_file`
- `verdict_matrix` when legacy diagnostics ran
- `canonical_status`
- `command_status`
- `target_verification_status`
- `artifact_quality_status`
- `delivery_status`
- `coverage_status`
- `acceptance_status`
- `run_tier`
- `release_status`
- `proof_eligible_tier`
- `required_matrix_acceptance_closed`

Production-proof candidate summaries additionally carry:
- `production_proof`
- `proof_scope`
- `external_runner_mode`
- `real_code_change_proof_complete`
- `production_proof_evidence_status`
- `production_proof_evidence_refs`
- `no_upstream_write_assertion`
- `delivery_manifest_file`
- `review_report_file`
- `latest_runtime_harness_report_file`

The W25-S03 committed production proof fixture is
`examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`. It is a sanitized derivative of the real
W25-S02 `full-journey-production-proof-ky-openai.yaml` run and records `proof_scope=full_code_changing_runtime`,
`real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, `overall_verdict=pass`,
mission-scoped changed paths, Runtime Harness/review/delivery evidence summaries, and a passing no-upstream-write
assertion. It intentionally excludes runtime output paths, target checkout contents, raw transcripts, and secrets.

Guided full-journey summaries also carry:
- `guided_journey`
- `artifacts.guided_journey_proof_file`
- `artifacts.guided_web_smoke_summary_file`
- `artifacts.guided_web_smoke_html_file`
- `artifacts.review_decision_file`
- `artifacts.release_packet_file`
- `artifacts.target_head_before` and `artifacts.target_head_after`
- `artifacts.target_git_status_without_runtime`

Each command and stage result should carry status, duration, transcript or artifact refs when available, failure class, missing evidence, and a recommendation. A command exit code of `0` is not enough for product observation success when required step evidence is missing.

Bounded summaries continue to carry:
- `target_checkout_root`
- `generated_project_profile_file`
- `routed_step_result_file`
- `compiled_context_ref`
- `adapter_raw_evidence_ref`

## Observation Report
The runner writes `live-e2e-observation-report` for every profile. The canonical v1 range is:

`discovery -> spec -> planning -> handoff -> execution -> review -> qa -> delivery`

`project init`, `intake create`, `project analyze`, and readiness validation are prelude/readiness evidence. `release` and `learning` are not part of the v1 matrix.

`overall_status` uses:
- `pass`: the public flow reached delivery and all observed step, artifact, and post-delivery code dimensions passed.
- `warn`: delivery evidence materialized, but code quality, no-op, Runtime Harness, review, post-delivery checks, legacy diagnostics, or artifact judge findings degraded the run.
- `not_pass`: the black-box flow could not reach delivery or delivery evidence did not materialize.

`deliver prepare` must be invoked with `--quality-gate-mode observe` by the live E2E runner. In observe mode Runtime Harness failures, no meaningful patch, and quality findings are copied into delivery output instead of preventing delivery evidence materialization.

## Artifact Judge
The runner does not call an in-product LLM route for artifact judging. The agent running live E2E reviews `agent_artifact_review_request_file` and may pass `--agent-judge-file <json>` on a subsequent run. The file should provide `artifact_quality_matrix[]` entries with `step`, `status`, `judge_source`, `artifact_refs`, and `findings`.

Judge criteria:
- traceability to feature request, mission, and previous step;
- completeness for the step;
- actionability for the next step;
- consistency with neighboring artifacts;
- absence of synthetic or no-op explanations that hide failure.

If no judge file is provided, the runner still writes the objective step/code matrix and sets each artifact-quality entry to `warn` with `agent-judge-not-provided`.

## Legacy Verdict Matrix
Full-journey summaries may include one legacy verdict matrix with:
- `scenario_family`
- `provider_variant_id`
- `feature_size`
- `target_selection`
- `feature_request_quality`
- `target_baseline_status`
- `discovery_quality`
- `provider_execution_status`
- `real_code_change_status`
- `post_run_verification_status`
- `post_run_diagnostic_status`
- `runtime_success`
- `runtime_harness_decision`
- `run_start_runtime_harness_decision`
- `latest_runtime_harness_decision`
- `artifact_quality`
- `code_quality`
- `feature_size_fit_status`
- `scenario_coverage_status`
- `delivery_release_quality`
- `learning_loop_closure`
- `quality_gate_decision`
- `overall_verdict`

Legacy `overall_verdict=fail` no longer forces the live E2E observation status to fail when delivery evidence materialized. Those findings downgrade the observation to `warn` unless they prevented the public flow from reaching delivery.

## Canonical Status
The run summary's canonical status block is the status source for operators.
Legacy `verdict_matrix` remains diagnostic.

Canonical fields:
- `command_status`: public subprocesses completed and emitted parseable payloads.
- `target_verification_status`: post-run primary verify summary result.
- `artifact_quality_status`: intake strictness, review artifact quality, and lineage consistency.
- `delivery_status`: `materialized`, `degraded`, `blocked`, or `not_materialized`.
- `coverage_status`: `covered_pass`, `covered_with_findings`, `attempted_failed`, or `not_attempted`.
- `acceptance_status`: `pass`, `warn`, or `fail`.
- `release_status`: `pass`, `fail`, `skipped`, or `not_attempted`.
- `proof_eligible_tier`: true only for `acceptance` and `production-proof`.
- `required_matrix_acceptance_closed`: true only when the run actually closes required matrix acceptance.

The target scorecard mirrors these canonical fields in addition to linking back
to the summary.

`command_status` is about technical command evidence, not final quality. If the
runner intentionally accepts a non-zero command because it emitted a readable
payload, the command diagnostic keeps the non-zero exit code while canonical
quality is reported through the relevant delivery, release, verification, or
artifact status.

Required matrix coverage closes only when `coverage_status=covered_pass` on
`run_tier=acceptance` or `run_tier=production-proof`. A delivery-reaching run
with warnings is `covered_with_findings`; it is useful evidence but does not
close required acceptance.

## Operator checks
- Summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- Full-journey runs resolve repo and mission from the curated catalog; they must not rely on raw `repo_url` plus free-form objective text.
- Full-journey runs resolve one explicit matrix cell and preserve `matrix_cell` plus `coverage_follow_up` in summary, review, audit, and learning artifacts.
- Full-journey runs use public `project init` outputs (`materialized_project_profile_file`, `materialized_bootstrap_assets_root`) rather than proof-runner-generated profile injection.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `review_report_file` exists and is contract-valid.
- `review-report.provider_traceability` matches the requested provider variant and adapter path.
- `review-report.feature_size_fit` stays inside the declared size budget for the mission.
- `review-report.artifact_quality.verify_summary_ref` points at the post-run `project verify` summary.
- `post_run_verify_status`, `provider_execution_status`, `real_code_change_status`, and `runtime_harness_decision` are observed post-delivery dimensions. Failures downgrade observation to `warn` when delivery evidence exists.
- `delivery_manifest_file` exists and is anchored to the target checkout.
- Proof runner execution stays CLI-only and remains valid with web UI detached.
- Guided proof execution starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; the target repository HEAD must remain unchanged and no remote write commands may be recorded unless an explicit future profile opts into network write-back.

## W21-S07 guided proof bundle (2026-05-06)
Canonical profile:
- `scripts/live-e2e/profiles/installed-user-guided-journey.yaml`

Canonical fixtures:
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-proof.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-web-smoke.sample.json`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-blocked-readiness.sample.json`

Run command:
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/installed-user-guided-journey.yaml
```

Pass evidence requires all of the following:
- CLI transcript files for doctor, onboard, app, next, mission create, run execution, review decision, delivery, release, and learning closure.
- Durable onboarding, intake, next-action, run, review, review-decision, delivery, release, learning, and web smoke artifacts.
- Public-repo safety assertions: `write_back_to_remote=false`, `patch-only` delivery mode, unchanged target `HEAD`, runtime state under `.aor/`, and no `.aor-live-e2e` state.
- Blocked and partial-readiness branches must keep the same no-write defaults visible and must not be marked pass without durable artifacts.

## W14-S07 matrix proof bundle (2026-04-24)
Observed curated runs:
- `w14-s07.full-journey-regress-ky`, `w14-s07.full-journey-regress-ky-anthropic`, `w14-s07.full-journey-regress-ky-medium-anthropic-rerun`, and `w14-s07.full-journey-release-ky-medium-openai` exercise all required `ky` cells.
- `w14-s07.full-journey-regress-httpie`, `w14-s07.full-journey-regress-httpie-anthropic`, `w14-s07.full-journey-repair-httpie-medium-anthropic`, and `w14-s07.full-journey-governance-httpie-medium-openai` exercise all required `httpie/cli` cells plus the repo-level provider-comparison pair.
- `w14-s07.full-journey-release-nextjs`, `w14-s07.full-journey-release-nextjs-anthropic`, `w14-s07.full-journey-repair-nextjs-medium-anthropic`, and `w14-s07.full-journey-governance-nextjs-large-openai` exercise all required `belgattitude/nextjs-monorepo-example` cells plus the repo-level provider-comparison pair.

Canonical fixtures:
- `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json`
- `examples/live-e2e/fixtures/w14-s07/`

Evidence note:
- the committed bundle preserves catalog-backed repo and mission resolution, scenario/provider/size matrix-cell validation, provider-pinned route overrides, public `project init`, mission-generated intake/discovery/spec/handoff artifacts, public `review run`, public `audit runs`, and public `learning handoff` closure artifacts.
- the bundle remains historical observation evidence. Under the canonical status model, it is tracked as `coverage_with_findings`; required matrix acceptance now needs a current `covered_pass` run on `run_tier=acceptance` or `run_tier=production-proof`.
- the bundle proves all mandatory scenario families: `regress`, `release`, `repair`, and `governance`.
- the bundle is explicitly classified as `proof_scope=coverage_with_findings` with `real_code_change_proof_complete=false`; it is coverage evidence, not full code-changing runtime proof.
- `overall_verdict` remains `pass_with_findings` in the committed proof because the deterministic external runner mock does not materialize mission code changes, leaving `review-report.code_quality=warn`.

## W25-S03 production proof fixture (2026-05-08)
Canonical fixture:
- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`

Evidence note:
- the fixture is derived from a real `full-journey-production-proof-ky-openai.yaml` run, not from `--examples-root` or a deterministic mock runner.
- it covers the required `ky.regress.small.openai` cell with `overall_verdict=pass`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.
- it records mission-scoped changed paths under `source/utils/merge.ts` and `test/headers.ts`, plus pass summaries for post-run verification, Runtime Harness, review, delivery, and learning-loop closure.
- it records `delivery_mode=patch-only`, `write_back_to_remote=false`, unchanged target `HEAD`, empty `commit_refs`, and `writeback_results=[patch-materialized]`.
- it is sanitized for commit: no runtime output tree, target checkout, local absolute path, raw transcript, or secret material is included.
