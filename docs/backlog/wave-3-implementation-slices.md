# W3 implementation slices

## Wave objective
Build the validation, eval, harness, certification, and promotion stack that makes AOR quality-native by default.

## Wave exit criteria
- asset-graph validation covers routes, wrappers, prompt bundles, step policies, datasets, suites, and live E2E profiles
- datasets and evaluation suites are registry-backed and executable through one eval runtime
- harness capture and replay produce normalized evidence that can be compared across changes
- wrapper and route changes can be certified through reusable eval and harness workflows
- promotion decisions are durable artifacts rather than ad hoc release notes

## Parallel start and sequencing notes
- `W3-S03` and `W3-S04` can proceed in parallel after registry work is in place.
- `W3-S05` joins eval and harness into a certification decision.
- `W3-S06` should run on the selected public targets from the live E2E catalog before delivery automation expands.

---

## W3-S01 — Validation kernel generalization and asset graph checks
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Expand validation from bootstrap-only checks into a reusable asset-graph validator for the whole control plane.
- **Primary modules:** `packages/contracts`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/**`
- **Hard dependencies:** W2-S05, W1-S04
- **Primary user-story surfaces:** reviewer / QA, security / compliance, AI platform owner

### Local tasks
1. Generalize validation so routes, wrappers, prompt bundles, policies, adapters, datasets, suites, and live E2E profiles can be checked together.
2. Model the asset graph and verify required refs, subject types, and compatibility constraints.
3. Produce machine-readable validation reports for full-asset validation, not just project bootstrap.
4. Document the distinction between deterministic validation and judge-based evaluation.

### Acceptance criteria
1. The validator can check the full asset graph, not only project bootstrap profiles.
2. Wrong-type refs, missing assets, and incompatible combinations fail deterministically before eval or execution.
3. Validation reports remain contract-compliant and reusable by CI and runtime flows.
4. Deterministic validation is clearly separated from judge-based evaluation and harness replay.

### Done evidence
- full-asset validation tests
- negative fixtures for wrong-type refs
- updated validation architecture docs

### Out of scope
- grader or judge execution
- harness replay logic

---

## W3-S02 — Dataset and evaluation suite registry
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Turn datasets and suites into governed runtime assets rather than loose examples.
- **Primary modules:** `packages/contracts`, `packages/orchestrator-core`, `examples/eval/**`
- **Hard dependencies:** W3-S01
- **Primary user-story surfaces:** AI platform owner, reviewer / QA, prompt engineer

### Local tasks
1. Register datasets and suites through a shared discovery and loading path.
2. Enforce subject-type compatibility between suites and their target asset family.
3. Expose a registry view that later eval, harness, and certification commands can consume.
4. Document naming, scoping, and versioning rules for new datasets and suites.

### Acceptance criteria
1. Datasets and suites are discoverable through one registry path instead of ad hoc file lookups.
2. Suites fail validation when the target subject type and dataset subject type do not match.
3. Eval and certification flows can resolve suites by ID and obtain their referenced datasets deterministically.
4. Docs explain how new datasets and suites should be authored and where they belong.

### Done evidence
- registry tests
- validated suite and dataset examples
- updated eval guidance docs

### Out of scope
- grader execution
- promotion decisions

---

## W3-S03 — Eval runner and scorer interface
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Create the first repeatable offline eval runtime for wrappers, prompt bundles, routes, and step behavior.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`
- **Hard dependencies:** W3-S02, W2-S04, W2-S05
- **Primary user-story surfaces:** reviewer / QA, AI platform owner, prompt engineer

### Local tasks
1. Implement an eval runner that can execute suites against their target assets and record results.
2. Define a scorer interface for deterministic checks, judge-based checks, and composite pass criteria.
3. Persist evaluation reports with enough metadata to compare runs across asset changes.
4. Provide a CLI surface for running an eval suite in offline mode.

### Acceptance criteria
1. An eval suite can be executed against a target asset family and produce a durable evaluation report.
2. Scoring supports deterministic, judge-based, or mixed criteria through one interface.
3. Evaluation reports record the asset under test, suite identity, scorer metadata, and summary metrics.
4. CLI eval execution works independently from delivery automation.

### Done evidence
- evaluation-report fixtures
- eval runner tests
- CLI eval smoke transcript

### Out of scope
- harness replay capture
- promotion gating by itself

---

## W3-S04 — Harness capture and replay runtime
- **Epic:** EPIC-4 Quality platform
- **State:** ready
- **Outcome:** Make step execution evidence replayable so platform changes can be tested against real traces rather than intuition.
- **Primary modules:** `packages/harness`, `packages/observability`, `packages/orchestrator-core`
- **Hard dependencies:** W3-S02, W2-S05
- **Primary user-story surfaces:** AI platform owner, operator / SRE, reviewer / QA

### Local tasks
1. Define a harness capture format for step inputs, selected assets, tool activity, and normalized outputs.
2. Support replay of captured traces through the same scoring path used by evals.
3. Record compatibility metadata so old captures can be rejected safely when incompatible.
4. Document how harness captures are produced, stored, and pruned.

### Acceptance criteria
1. The system can capture step execution evidence into a reusable harness artifact.
2. Harness captures can be replayed through a stable interface and produce comparable output.
3. Replay rejects incompatible captures explicitly rather than silently mis-scoring them.
4. Harness lifecycle rules for storage and cleanup are documented.

### Done evidence
- harness capture fixtures
- replay tests
- updated harness architecture docs

### Out of scope
- certification decisions
- public-target rehearsals

---

## W3-S05 — Certification and promotion decision baseline
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Convert eval and harness output into an explicit certification and promotion gate for platform assets.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `apps/cli`
- **Hard dependencies:** W3-S03, W3-S04
- **Primary user-story surfaces:** AI platform owner, engineering manager / planner, reviewer / QA

### Local tasks
1. Combine eval reports and harness replay results into a certification decision for wrappers, routes, and prompt bundles.
2. Materialize a promotion-decision artifact with pass, hold, and fail semantics.
3. Expose a CLI path for certifying a changed asset set before it becomes default.
4. Document the minimum evidence bar for promotion decisions.

### Acceptance criteria
1. Wrapper, route, or prompt-bundle changes can be certified through reusable eval and harness evidence.
2. Promotion decisions are stored as durable artifacts with pass, hold, and fail states.
3. The certification path names the exact evidence set that justified the decision.
4. Docs describe the minimum evidence bar for making an asset the new default.

### Done evidence
- promotion-decision fixtures
- certification command transcript
- updated quality runbooks

### Out of scope
- delivery write-back
- operator UI approval flows

---

## W3-S06 — Quality rehearsal on selected public targets
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Prove that eval, harness, and certification work on real repositories before delivery automation expands.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `packages/harness`, `apps/cli`
- **Hard dependencies:** W3-S05, W0-S05
- **Primary user-story surfaces:** operator / SRE, AI platform owner, security / compliance

### Local tasks
1. Run the quality stack against at least two of the selected public targets from the live E2E catalog.
2. Capture evaluation reports, harness traces, and certification outputs as durable evidence.
3. Document per-target caveats, runtime costs, and safe abort conditions.
4. Use the rehearsal to refine the standard quality runbook.

### Acceptance criteria
1. Quality rehearsal works on selected public targets from the live E2E catalog.
2. Evaluation, harness, and certification artifacts remain durable and inspectable after the run.
3. Per-target caveats and abort conditions are documented explicitly.
4. The standard quality runbook is updated from rehearsal findings.

### Done evidence
- public-target quality transcripts
- evaluation and harness artifact set
- updated runbooks

### Out of scope
- delivery write-back
- operator UI intervention flows

---
