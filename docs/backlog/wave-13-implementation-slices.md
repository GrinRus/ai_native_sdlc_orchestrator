# W13 implementation slices

## Wave objective
Add a catalog-backed full-journey live E2E layer that starts from a concrete feature mission on curated public repositories, runs the public AOR flow end-to-end, and produces review plus learning verdict artifacts alongside runtime success.

## Wave exit criteria
- curated repo and feature-mission catalog exists under `scripts/live-e2e/catalog/` and remains aligned with operator runbooks
- `aor project init` can bootstrap a clean target repository without harness-side asset injection
- `aor intake create` and `aor discovery run` materialize feature-specific mission input and preserve traceability
- `aor run start` launches real execution and `aor review run` / `aor learning handoff` expose public verdict and closure artifacts
- internal live E2E harness supports mandatory full-journey catalog profiles in addition to bounded rehearsal profiles
- restored `live-e2e-runner` skill can prepare the mission request, run the public flow, and report a verdict matrix across runtime, discovery, artifact, code, delivery, and learning dimensions

## Parallel start and sequencing notes
- `W13-S01` starts first because the source-of-truth docs and shared backlog must define the layered full-journey model before runtime work proceeds.
- `W13-S02` follows `W13-S01` so curated repos and feature missions exist before bootstrap or harness changes rely on them.
- `W13-S03` must land before `W13-S04` because full-journey live E2E needs a real public bootstrap plus feature-intent intake path.
- `W13-S04` must land before `W13-S05` because review and learning closure depend on feature-driven discovery and real execution runs.
- `W13-S06` closes the wave after the public surfaces exist and the harness plus skills can exercise them end-to-end.

---

## W13-S01 — Backlog-first full-journey live E2E realignment
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Update source-of-truth docs so live E2E is explicitly layered into bounded rehearsal and catalog-backed full-journey acceptance with repo-specific feature missions.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, project bootstrap / onboarding, reviewer / QA, delivery engineer

### Local tasks
1. Add W13 to roadmap, master backlog, epic map, and dependency graph.
2. Rewrite source-of-truth docs so full-journey live E2E is catalog-backed, feature-driven, and verdict-oriented.
3. Clarify that bounded rehearsal profiles remain but no longer claim to prove the full user journey.
4. Update operator docs to state that the restored runner skill owns verdict assembly and mission preparation.

### Acceptance criteria
1. Shared backlog docs agree on the W13 slice sequence and ownership.
2. Source-of-truth docs describe full-journey live E2E as curated repo + curated feature mission + public CLI flow.
3. Source-of-truth docs state that success includes discovery, artifact, code, delivery, and learning-loop quality, not only runtime pass/fail.
4. Backlog integrity checks pass after the planning update.

### Done evidence
- synchronized W13 entries across roadmap, backlog, epics, and dependency graph
- updated source-of-truth docs describing layered live E2E and mission-driven full-journey acceptance

### Out of scope
- implementing new CLI/runtime surfaces in this slice
- changing harness internals in this slice

---

## W13-S02 — Curated target and feature mission catalog
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add a machine-readable internal catalog of allowed full-journey target repositories and feature missions, keeping the human runbook catalog aligned.
- **Primary modules:** `scripts/live-e2e/catalog/**`, `scripts/live-e2e/profiles/**`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** W13-S01
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, finance / audit / hygiene

### Local tasks
1. Add a machine-readable target catalog with fixed repo refs, setup commands, safety defaults, and feature missions.
2. Define feature mission shape: mission id, brief, allowed scope, forbidden scope, evidence expectations, and change budgets.
3. Add full-journey profiles that resolve through catalog ids rather than free-form target repo metadata.
4. Update operator runbooks to point at the curated repo and mission mapping.

### Acceptance criteria
1. Full-journey profiles resolve only curated repos and curated missions from the internal catalog.
2. The human runbook catalog and machine-readable catalog stay semantically aligned.
3. Feature missions declare enough scope and acceptance detail for review and code-quality checks.
4. Harness tests cover missing repo id and missing mission id failures.

### Done evidence
- machine-readable target catalog and feature missions under `scripts/live-e2e/catalog/**`
- full-journey profiles referencing catalog ids and mission ids
- updated target-catalog operator runbook describing the same repo and mission set

### Out of scope
- expanding the public contract surface for arbitrary external repo catalogs
- broad target-catalog growth beyond the curated baseline

---

## W13-S03 — Public bootstrap and feature-intent intake
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Extend public bootstrap and intake surfaces so a clean target repo can be turned into an AOR-ready workspace and one feature mission can be materialized without harness-side file injection.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/product/**`
- **Hard dependencies:** W13-S02
- **Primary user-story surfaces:** project bootstrap / onboarding, product sponsor / owner, delivery engineer

### Local tasks
1. Extend `project init` with bootstrap materialization flags and outputs.
2. Add bootstrap asset and project-profile materialization from packaged AOR assets.
3. Extend `intake create` with feature-intent inputs and mission traceability.
4. Preserve artifact-packet durability while moving feature-intent details into packet bodies and refs.

### Acceptance criteria
1. `aor project init` can bootstrap a clean repo without a pre-existing `project.aor.yaml`.
2. `aor intake create` can create a mission-linked feature request artifact through public CLI inputs.
3. Re-running bootstrap is idempotent and reports materialization status clearly.
4. CLI, contract, and integration tests cover bootstrap and intake paths.

### Done evidence
- new project-init outputs for bootstrap materialization
- feature-linked intake artifact packet generated through public CLI
- passing tests for idempotent bootstrap and mission-linked intake creation

### Out of scope
- arbitrary user-authored bootstrap template registries
- making mission intake mandatory for all legacy bounded flows

---

## W13-S04 — Feature-driven discovery and execution lifecycle
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Preserve feature traceability through discovery and make `run start` the real execution entrypoint for full-journey runs.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W13-S03
- **Primary user-story surfaces:** discovery / research, engineering manager / planner, delivery engineer, operator / SRE

### Local tasks
1. Extend `discovery run` with explicit feature-input packet consumption.
2. Carry mission traceability into discovery outputs and planning handoff artifacts.
3. Extend `run start` so it launches actual execution and preserves run-linked step evidence.
4. Ensure `run status` exposes the resulting execution lineage.

### Acceptance criteria
1. Discovery output is traceable to the selected mission input.
2. Wave and handoff artifacts preserve mission-linked planning context.
3. `run start` launches actual execution and no longer acts as control-state-only for the full-journey path.
4. CLI and harness tests cover execution success and failure branches through `run start`.

### Done evidence
- discovery output with mission traceability
- run-linked execution evidence launched through `run start`
- updated command help, catalog docs, and tests for execution lifecycle changes

### Out of scope
- replacing legacy routed verify shortcuts for every existing bounded use case
- full UI automation for run-control follow mode

---

## W13-S05 — Public review and learning-loop closure surfaces
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Add public `review run` and `learning handoff` commands with durable contract-backed artifacts for review verdicts and learning closure.
- **Primary modules:** `apps/cli`, `packages/contracts`, `packages/observability`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W13-S04
- **Primary user-story surfaces:** reviewer / QA, incident / improvement owner, finance / audit / hygiene

### Local tasks
1. Add `review-report`, `learning-loop-scorecard`, and `learning-loop-handoff` contract families.
2. Implement `aor review run` with discovery, artifact, and code-quality verdict sections.
3. Implement `aor learning handoff` with public closure artifacts instead of internal harness helpers.
4. Update audit and operator docs to reference the new surfaces and their verdict semantics.

### Acceptance criteria
1. `review run` emits a contract-valid report-only verdict artifact.
2. `learning handoff` emits contract-valid scorecard and handoff artifacts and links incidents when required.
3. Contract loader and CLI tests cover the new public surfaces.
4. Quality and audit read surfaces can observe the new artifacts through runtime evidence.

### Done evidence
- new contract docs and loader index entries
- public review and learning CLI surfaces with durable artifacts
- updated audit and operator docs referencing review and closure artifacts

### Out of scope
- automatic downstream blocking at command level from review verdicts
- production portfolio analytics beyond one run’s closure evidence

---

## W13-S06 — Full-journey harness and restored runner skill
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Update the internal harness for curated full-journey runs, keep bounded profiles, and restore a dedicated runner skill that prepares feature missions and assembles a verdict matrix.
- **Primary modules:** `scripts/live-e2e/**`, `.agents/skills/**`, `docs/ops/**`, `examples/live-e2e/**`, `apps/cli/test/**`
- **Hard dependencies:** W13-S05
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, delivery engineer

### Local tasks
1. Add full-journey harness mode that resolves curated repo and mission catalog entries.
2. Make the harness execute the public bootstrap, intake, discovery, planning, execution, review, audit, and learning flow.
3. Restore `live-e2e-runner` skill and keep `live-e2e-preflight` narrow.
4. Refresh runbooks, profiles, tests, and proof fixtures for the W13 full-journey layer.

### Acceptance criteria
1. Full-journey harness mode rejects uncataloged repos and missing missions.
2. Full-journey harness mode prepares a mission-linked feature request and discovery path before execution.
3. The restored runner skill reports verdicts across target selection, feature request quality, discovery quality, runtime success, artifact quality, code quality, delivery/release quality, and learning-loop closure.
4. Bounded profiles remain usable as fast rehearsal coverage.

### Done evidence
- full-journey harness mode with curated repo and mission resolution
- restored `live-e2e-runner` skill plus updated `live-e2e-preflight`
- updated runbooks and tests showing both bounded and full-journey rehearsal layers
- committed W13 proof bundle under `examples/live-e2e/fixtures/w13-s06/` covering `ky`, `httpie/cli`, and `nextjs-monorepo-example`

### Out of scope
- arbitrary external mission authoring during mandatory acceptance
- replacing bounded rehearsal profiles with full-journey runs everywhere
