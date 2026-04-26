---
name: live-e2e-runner
description: Use when you need to run or assess AOR live E2E profiles, especially catalog-backed full-journey matrix cells on curated repositories.
---

1. Start with `docs/ops/live-e2e-standard-runner.md` and `docs/ops/live-e2e-target-catalog.md`.
2. Decide whether the requested run is bounded rehearsal or full-journey acceptance.
3. For full-journey acceptance, resolve one curated matrix cell from:
   - `scripts/live-e2e/catalog/targets/*.yaml`
   - `scripts/live-e2e/catalog/scenarios/*.yaml`
   - `scripts/live-e2e/catalog/providers/*.yaml`
   - `scripts/live-e2e/profiles/full-journey-*.yaml`
4. The matrix cell must pin:
   - target repo
   - feature mission
   - `scenario_family`
   - `provider_variant_id`
   - declared `feature_size`
4. Use the installed-user proof runner entrypoint:
   - `node ./scripts/live-e2e/run-profile.mjs --project-ref . --profile <profile>`
5. For full-journey runs, ensure the public lifecycle is exercised end-to-end:
   - `project init`
   - runner-prepared feature request input
   - `intake create`
   - `project analyze`
   - `project validate`
   - `project verify --routed-dry-run-step implement`
   - `discovery run`
   - `spec build`
   - `wave create`
   - `handoff approve`
   - `project validate --require-approved-handoff`
   - `run start`
   - `run status`
   - `review run`
   - `eval run`
   - asset certification when the profile requires certification
   - `deliver prepare`
   - `release prepare` for release-shaped missions
   - `audit runs`
   - `incident open` or `incident recertify` on degraded branches
   - `learning handoff`
6. The runner is responsible for preparing the feature request input itself. Do not skip directly to execution or rely on proof-runner-side synthetic discovery.
7. Inspect the resulting artifacts and return one verdict matrix with:
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
   - `runtime_harness_decision`
   - `overall_verdict`
8. Explain why the chosen matrix cell was selected and which required cells remain uncovered for that repo.
9. Treat the run as failed when any of these are true:
   - repo or mission is not in the curated catalog
   - scenario family or provider variant is not allowed for that mission
   - `review-report` returns `fail`
   - `review-report.provider_traceability` or `review-report.feature_size_fit` returns `fail`
   - critical delivery or release lineage is missing
   - `runtime-harness-report` is missing or masks permission/no-op failure as success
   - learning-loop closure artifacts are missing
