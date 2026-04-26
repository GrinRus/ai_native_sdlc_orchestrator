# W14 implementation slices

## Wave objective
Expand catalog-backed full-journey live E2E into a curated matrix across scenario family, pinned provider variant, and size-classed feature missions while preserving public-flow execution and durable quality verdicts.

## Wave exit criteria
- machine-readable provider-variant and scenario-policy catalogs exist under `scripts/live-e2e/catalog/**`
- curated target catalogs define at least one `small`, one `medium`, and one `large` mission per repo together with supported scenarios and pinned-provider recommendations
- full-journey profiles pin `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id`
- the installed-user proof runner rejects invalid matrix cells and applies deterministic provider-pinned route overrides for accepted cells
- review, audit, summary, and learning-loop artifacts preserve scenario/provider/size metadata plus provider-execution and feature-size-fit verdicts
- runner skill, runbooks, tests, and proof fixtures describe and prove the curated matrix rather than a single profile per repo

## Parallel start and sequencing notes
- `W14-S01` starts first because the shared backlog and source-of-truth docs must define the matrix model before catalog or runtime work proceeds.
- `W14-S02` follows `W14-S01` so scenario and provider taxonomy exists before target catalogs and profiles bind to it.
- `W14-S03` depends on `W14-S02` because target missions must bind to defined scenario families and provider variants.
- `W14-S04` depends on `W14-S03` because provider-pinned full-journey profiles require the expanded target catalogs.
- `W14-S05` depends on `W14-S04` because proof-runner/runtime validation needs concrete matrix-aware profiles and catalogs.
- `W14-S06` depends on `W14-S05` because review, audit, and closure semantics must read the new matrix-aware proof evidence.
- `W14-S07` closes the wave after proof, skill guidance, and runbooks reflect the matrix model end to end.

---

## W14-S01 — Backlog and source-of-truth realignment
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Update roadmap, source-of-truth docs, and operator language so live E2E is explicitly modeled as a curated matrix across scenario family, pinned provider, and feature size.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, AI platform owner, finance / audit / hygiene

### Local tasks
1. Add W14 to roadmap, master backlog, epic map, and dependency graph.
2. Rewrite source-of-truth docs so full-journey live E2E is described as a curated matrix rather than one canonical profile per repo.
3. Document the three matrix axes: `scenario_family`, `provider_variant`, and `feature_size`.
4. Clarify that the runner selects a matrix cell and reports remaining uncovered required cells.

### Acceptance criteria
1. Shared backlog docs agree on the W14 slice sequence and ownership.
2. Source-of-truth docs describe live E2E as `repo + mission + scenario family + pinned provider + feature size`.
3. Source-of-truth docs state that feature size is curated during catalog authoring, not improvised during a run.
4. Backlog integrity checks pass after the planning update.

### Done evidence
- synchronized W14 entries across roadmap, backlog, epics, and dependency graph
- updated README, product, architecture, and ops docs describing the matrix model

### Out of scope
- runtime/catalog changes in this slice
- proof fixture refresh in this slice

---

## W14-S02 — Scenario and provider catalogs
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add machine-readable scenario-policy and provider-variant catalogs that define the live E2E matrix taxonomy and pinned execution rules.
- **Primary modules:** `scripts/live-e2e/catalog/scenarios/**`, `scripts/live-e2e/catalog/providers/**`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W14-S01
- **Primary user-story surfaces:** operator / SRE, AI platform owner, reviewer / QA

### Local tasks
1. Add machine-readable scenario policies for `regress`, `release`, `repair`, and `governance`.
2. Add machine-readable provider variants for `openai-primary`, `anthropic-primary`, and `open-code-primary`.
3. Document mandatory vs extended provider coverage and per-scenario required stages/evidence.
4. Add validation coverage for scenario-policy and provider-variant documents.

### Acceptance criteria
1. Scenario and provider catalogs are machine-readable and human-documented.
2. Provider variants clearly define primary adapter, fallback policy, and route-override policy.
3. Scenario policies clearly define required stages, required evidence, release requirements, and incident/governance defaults.
4. Contract or validation tests cover invalid scenario/provider documents.

### Done evidence
- scenario-policy catalog under `scripts/live-e2e/catalog/scenarios/`
- provider-variant catalog under `scripts/live-e2e/catalog/providers/`
- updated contract or validation coverage for both catalog families

### Out of scope
- target-specific mission expansion in this slice
- proof-runner runtime enforcement in this slice

---

## W14-S03 — Feature-size taxonomy and target mission expansion
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Expand each curated target repo with small/medium/large missions, explicit size budgets, supported scenarios, and pinned-provider recommendations.
- **Primary modules:** `scripts/live-e2e/catalog/targets/**`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** W14-S02
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, delivery engineer

### Local tasks
1. Add explicit `feature_size`, `size_budget`, `size_rationale`, `supported_scenarios`, and `recommended_provider_variants` to each curated mission.
2. Ensure every curated repo defines at least one `small`, one `medium`, and one `large` mission.
3. Add repo-level required matrix coverage cells and cross-provider comparison guidance.
4. Rewrite the human target catalog to show repo shape, mission sizes, and scenario suitability.

### Acceptance criteria
1. Every curated repo exposes one `small`, one `medium`, and one `large` mission.
2. Missions declare supported scenarios and pinned-provider recommendations explicitly.
3. Repo-level required matrix cells match the W14 plan.
4. Validation tests cover missing size/scenario/provider mission metadata.

### Done evidence
- expanded target catalogs with size-classed missions and required matrix cells
- updated target-catalog runbook showing mission-size and scenario suitability

### Out of scope
- proof-runner runtime enforcement in this slice
- proof fixture refresh in this slice

---

## W14-S04 — Provider-pinned full-journey profiles
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add full-journey profiles for required matrix cells and pin each profile to a scenario family and provider variant in addition to repo and mission.
- **Primary modules:** `scripts/live-e2e/profiles/**`, `scripts/live-e2e/catalog/**`, `docs/ops/**`
- **Hard dependencies:** W14-S03
- **Primary user-story surfaces:** operator / SRE, delivery engineer

### Local tasks
1. Extend full-journey profile shape with `scenario_family` and `provider_variant_id`.
2. Add required matrix-cell profiles for `ky`, `httpie/cli`, and `nextjs-monorepo-example`.
3. Keep existing canonical profile names aligned with one explicit matrix cell and add new profiles for the remaining required cells.
4. Add validation coverage so matrix profiles fail fast when any required key is missing.

### Acceptance criteria
1. Full-journey profiles pin all four matrix keys.
2. Required repo-level coverage cells are represented by concrete profile files.
3. At least one provider-comparison pair exists between `openai-primary` and `anthropic-primary`.
4. Validation tests cover missing scenario/provider keys.

### Done evidence
- expanded full-journey profiles pinned to scenario/provider/mission/repo cells
- tests proving full-journey profiles fail when matrix keys are missing

### Out of scope
- proof-runner runtime verdict expansion in this slice
- proof fixture refresh in this slice

---

## W14-S05 — Proof runner and verdict expansion
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Teach the installed-user proof runner to validate matrix cells, materialize provider-pinned route overrides, and extend summaries plus verdict matrices with matrix metadata.
- **Primary modules:** `scripts/live-e2e/**`, `apps/cli`, `packages/orchestrator-core`, `docs/ops/**`
- **Hard dependencies:** W14-S04
- **Primary user-story surfaces:** operator / SRE, AI platform owner, reviewer / QA

### Local tasks
1. Require `scenario_family` and `provider_variant_id` for full-journey profiles.
2. Resolve scenario policies and provider variants from machine-readable catalogs.
3. Materialize deterministic provider-pinned route overrides for matrix-cell runs and pass them through the public CLI flow.
4. Extend run summary, scorecard, and verdict matrix with `scenario_family`, `provider_variant_id`, `feature_size`, `scenario_coverage_status`, `provider_execution_status`, and `feature_size_fit_status`.

### Acceptance criteria
1. The proof runner rejects unknown scenarios, unknown providers, and unsupported mission/scenario/provider combinations.
2. The proof runner uses deterministic provider-pinned route overrides instead of default fallback routing for matrix-cell runs.
3. Summaries and verdict matrices preserve matrix metadata and expanded verdict dimensions.
4. Proof-runner tests cover invalid matrix cells and successful provider-pinned execution.

### Done evidence
- matrix-aware proof runner runtime with provider-pinned route overrides
- expanded summary and verdict artifacts
- proof-runner tests covering invalid and valid matrix-cell execution

### Out of scope
- review/audit/closure artifact changes in this slice
- proof fixture refresh in this slice

---

## W14-S06 — Review, audit, and closure alignment
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Extend review, audit, and learning-loop closure artifacts so they preserve feature-size fit, provider traceability, scenario traceability, and matrix follow-up hints.
- **Primary modules:** `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W14-S05
- **Primary user-story surfaces:** reviewer / QA, finance / audit / hygiene, incident / improvement owner

### Local tasks
1. Extend `review run` to emit `feature_size_fit` and `provider_traceability`.
2. Extend `audit runs` to surface matrix-cell and provider-traceability evidence for each run.
3. Extend `learning handoff` artifacts with `matrix_cell` and `coverage_follow_up`.
4. Update contract or validation docs/tests for the expanded review and closure artifacts.

### Acceptance criteria
1. `review-report` preserves feature-size and provider traceability information.
2. `audit runs` exposes matrix-aware closure context for audited runs.
3. `learning-loop-scorecard` and `learning-loop-handoff` preserve matrix-cell and coverage-follow-up metadata.
4. Tests cover in-budget vs over-budget feature-size fits and provider traceability.

### Done evidence
- expanded review, audit, and learning-loop artifacts
- tests covering feature-size fit and provider traceability

### Out of scope
- runner-skill refresh and proof fixture refresh in this slice

---

## W14-S07 — Proof bundle and skill refresh
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Refresh runner skill guidance, runbooks, and proof bundles so they select and prove curated matrix cells rather than one profile per repo.
- **Primary modules:** `.agents/skills/**`, `docs/ops/**`, `examples/live-e2e/**`, `scripts/test/**`
- **Hard dependencies:** W14-S06
- **Primary user-story surfaces:** operator / SRE, reviewer / QA

### Local tasks
1. Update `live-e2e-runner` skill so it chooses matrix cells and reports remaining uncovered required cells.
2. Refresh runbooks with matrix-cell examples for small/regress/openai, medium/repair/anthropic, and large/release/openai or open-code.
3. Regenerate proof fixtures so committed evidence identifies scenario family, provider variant, feature size, and actual routed adapter path.
4. Keep bounded rehearsal guidance intact while repositioning full-journey acceptance as a matrix.

### Acceptance criteria
1. Runner skill guidance is matrix-cell based and no longer repo+mission only.
2. Proof bundles identify exact matrix cells and show provider/size/scenario metadata.
3. Committed proof demonstrates at least one successful run per mandatory scenario family and at least one provider-comparison pair.
4. Runbooks show how to select canonical matrix-cell runs.

### Done evidence
- refreshed runner skill and runbooks
- committed W14 proof bundle under `examples/live-e2e/fixtures/w14-s07/` covering all required matrix cells and provider-comparison pairs
- updated proof-runner tests proving matrix-cell metadata persists into evidence

### Out of scope
- expanding live E2E into a Cartesian product across every possible repo/provider/scenario combination
