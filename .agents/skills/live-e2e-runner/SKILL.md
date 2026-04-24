---
name: live-e2e-runner
description: Use when you need to run or assess AOR live E2E profiles, especially catalog-backed full-journey missions on curated repositories.
---

1. Start with `docs/ops/live-e2e-standard-runner.md` and `docs/ops/live-e2e-target-catalog.md`.
2. Decide whether the requested run is bounded rehearsal or full-journey acceptance.
3. For full-journey acceptance, resolve both the curated target repo and curated feature mission from `scripts/live-e2e/catalog/targets/*.yaml` and `scripts/live-e2e/profiles/full-journey-*.yaml`.
4. Use the internal harness entrypoint:
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
   - `harness certify` when the profile requires certification
   - `deliver prepare`
   - `release prepare` for release-shaped missions
   - `audit runs`
   - `incident open` or `incident recertify` on degraded branches
   - `learning handoff`
6. The runner is responsible for preparing the feature request input itself. Do not skip directly to execution or rely on harness-side synthetic discovery.
7. Inspect the resulting artifacts and return one verdict matrix with:
   - `target_selection`
   - `feature_request_quality`
   - `discovery_quality`
   - `runtime_success`
   - `artifact_quality`
   - `code_quality`
   - `delivery_release_quality`
   - `learning_loop_closure`
   - `overall_verdict`
8. Treat the run as failed when any of these are true:
   - repo or mission is not in the curated catalog
   - `review-report` returns `fail`
   - critical delivery or release lineage is missing
   - learning-loop closure artifacts are missing
