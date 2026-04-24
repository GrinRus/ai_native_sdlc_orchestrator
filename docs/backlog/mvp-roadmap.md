# MVP roadmap

The authoritative planning model for implementation lives in:
- `docs/backlog/backlog-operating-model.md`
- `docs/backlog/mvp-implementation-backlog.md`
- `docs/backlog/orchestrator-epics.md`
- `docs/backlog/slice-dependency-graph.md`
- the wave documents `docs/backlog/wave-0-implementation-slices.md` through `docs/backlog/wave-14-implementation-slices.md`

## Wave summary
| Wave | Goal | Slice count | Primary epics | Detail doc |
|---|---|---:|---|---|
| W0 | Turn the design package into a contributor-safe and machine-validated repository foundation. | 6 | EPIC-0, EPIC-7 | `docs/backlog/wave-0-implementation-slices.md` |
| W1 | Make project bootstrap and early packet materialization work end to end in headless mode. | 8 | EPIC-6, EPIC-1, EPIC-4, EPIC-2, EPIC-7 | `docs/backlog/wave-1-implementation-slices.md` |
| W2 | Introduce the first real routed execution path across routes, wrappers, prompt bundles, policies, and adapters. | 6 | EPIC-3, EPIC-7 | `docs/backlog/wave-2-implementation-slices.md` |
| W3 | Build the validation, eval, harness, certification, and promotion stack that makes AOR quality-native by default. | 6 | EPIC-4, EPIC-7 | `docs/backlog/wave-3-implementation-slices.md` |
| W4 | Add safe write-back modes, manifests, and release artifacts so AOR can move from rehearsal to controlled delivery. | 6 | EPIC-5, EPIC-7 | `docs/backlog/wave-4-implementation-slices.md` |
| W5 | Expose operator-grade APIs, live views, and standardized live E2E orchestration for the full control plane. | 6 | EPIC-6, EPIC-7 | `docs/backlog/wave-5-implementation-slices.md` |
| W6 | Deliver command-first post-MVP expansion for intake, run control, UI lifecycle, delivery/release prep, and incident/audit flows. | 6 | EPIC-0, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-6-implementation-slices.md` |
| W7 | Close MVP+ governance and quality stories for certification, finance evidence, and learning-loop integration. | 5 | EPIC-4, EPIC-7 | `docs/backlog/wave-7-implementation-slices.md` |
| W8 | Close later-maturity stories for strategic operator visibility, governance hardening, context lifecycle maturity, and multi-repo delivery maturity. | 9 | EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-8-implementation-slices.md` |
| W9 | Stabilize post-audit findings across routed evidence durability, source-of-truth docs, public quality surfaces, detached transport, and live execution foundations. | 8 | EPIC-0, EPIC-3, EPIC-4, EPIC-6 | `docs/backlog/wave-9-implementation-slices.md` |
| W10 | Reopen production-facing gaps left after the baseline audit across external runner execution, networked fork-first delivery, detached mutation transport, and live target-catalog proof. | 5 | EPIC-3, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-10-implementation-slices.md` |
| W11 | Close the remaining target-backed live E2E proof gap through source-of-truth repair, target-checkout execution, target-anchored delivery evidence, and refreshed external proof. | 5 | EPIC-0, EPIC-3, EPIC-5, EPIC-7 | `docs/backlog/wave-11-implementation-slices.md` |
| W12 | Remove public live-E2E product surfaces, move rehearsal to an internal black-box harness, and refresh proof through installed-user style execution. | 4 | EPIC-0, EPIC-6, EPIC-7 | `docs/backlog/wave-12-implementation-slices.md` |
| W13 | Add a full user-journey live E2E layer on curated public repositories, start each run from a concrete feature mission, and evaluate runtime plus quality verdicts through public surfaces. | 6 | EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-7 | `docs/backlog/wave-13-implementation-slices.md` |
| W14 | Expand live E2E into a curated matrix across scenario families, pinned providers, and size-classed feature missions with matrix-aware review, audit, and closure evidence. | 7 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-14-implementation-slices.md` |

## Post-MVP story allocation
| Slice ID | Story IDs closed |
|---|---|
| W6-S01 | enablement slice (no direct story closure) |
| W6-S02 | PSO-07, DIS-07, PBO-06, PBO-07 |
| W6-S03 | EMP-07, DEV-09, OPS-09, SEC-05 |
| W6-S04 | DEV-08, ARC-06 |
| W6-S05 | DTX-06, DTX-07, RMO-05 |
| W6-S06 | INC-05 |
| W7-S01 | ARC-07, RQA-05, FIN-07 |
| W7-S02 | AIP-07, AIP-08, AIP-09, AIP-10, FIN-05 |
| W7-S03 | INC-04 |
| W7-S04 | FIN-06 |
| W7-S05 | integration closure (wave-level evidence) |
| W8-S01 | PSO-08, EMP-08 |
| W8-S02 | DIS-08, ARC-08 |
| W8-S03 | DEV-10, SEC-06 |
| W8-S04 | OPS-10 |
| W8-S05 | RQA-06, AIP-11 |
| W8-S06 | INC-06, AIP-12 |
| W8-S07 | RMO-06, PBO-08, DTX-08, FIN-08 |
| W8-S08 | integration closure (compiled-context runtime foundation) |
| W8-S09 | integration closure (context lifecycle governance evidence) |
| W9-S01 | post-audit stabilization bugfix (no direct story closure) |
| W9-S02 | post-audit documentation drift repair (no direct story closure) |
| W9-S03 | post-audit API/runtime alignment fix (no direct story closure) |
| W9-S04 | post-audit contract coverage enablement (no direct story closure) |
| W9-S05 | post-audit quality surface completion (no direct story closure) |
| W9-S06 | post-audit promotion surface completion (no direct story closure) |
| W9-S07 | post-audit transport baseline feature (no direct story closure) |
| W9-S08 | post-audit live execution baseline feature (no direct story closure) |
| W10-S01 | productionization gap closure: external live adapter execution (no direct story closure) |
| W10-S02 | productionization gap closure: networked fork-first delivery (no direct story closure) |
| W10-S03 | productionization gap closure: detached mutation transport (no direct story closure) |
| W10-S04 | productionization gap closure: detached transport auth hardening (no direct story closure) |
| W10-S05 | productionization gap closure: external live target-catalog proof (no direct story closure) |
| W11-S01 | productionization gap closure: source-of-truth reality repair (no direct story closure) |
| W11-S02 | productionization gap closure: target-backed workspace materialization (no direct story closure) |
| W11-S03 | productionization gap closure: profile-driven live preflight and routed execution (no direct story closure) |
| W11-S04 | productionization gap closure: target-anchored delivery evidence (no direct story closure) |
| W11-S05 | productionization gap closure: refreshed target-catalog proof bundle (no direct story closure) |
| W12-S01 | public surface realignment and breaking removal planning (no direct story closure) |
| W12-S02 | internal black-box installed-user harness (no direct story closure) |
| W12-S03 | breaking CLI and contract removal (no direct story closure) |
| W12-S04 | proof refresh after surface cleanup (no direct story closure) |

## W0 — repository and contract foundation
**Goal:** Turn the design package into a contributor-safe and machine-validated repository foundation.

**Exit criteria:**
- the workspace has honest root commands and a stable scaffold for future packages and apps
- contracts and examples are loaded and checked through shared validation paths
- the backlog model is wave → epic → slice → local task and is usable by agents without guesswork
- live E2E profiles support a no-write preflight path before any delivery automation exists
- CI gates prevent contract, example, and roadmap drift

**Detailed slices:** `docs/backlog/wave-0-implementation-slices.md`

## W1 — bootstrap and packet foundation
**Goal:** Make project bootstrap and early packet materialization work end to end in headless mode.

**Exit criteria:**
- `aor project init`, `analyze`, `validate`, and `verify` have working smoke paths
- runtime state materializes under `.aor/` with durable project-scoped artifact directories
- project-analysis, validation, and step-result artifacts are contract-compliant and reloadable
- artifact, wave, and handoff packet skeletons can be created and validated
- a no-write bootstrap rehearsal works on the AOR repo and one selected public target

**Detailed slices:** `docs/backlog/wave-1-implementation-slices.md`

## W2 — routed execution foundation
**Goal:** Introduce the first real routed execution path across routes, wrappers, prompt bundles, policies, and adapters.

**Exit criteria:**
- route resolution works for at least discovery, research, plan, implement, review, and QA step shapes
- wrappers, prompt bundles, and step policies resolve through one runtime stack
- the adapter SDK supports capability negotiation and a mock adapter for deterministic rehearsal
- routed execution writes durable step results with asset, budget, and adapter metadata
- a no-write routed rehearsal runs against approved packets without delivery-side write-back

**Detailed slices:** `docs/backlog/wave-2-implementation-slices.md`

## W3 — quality foundation
**Goal:** Build the validation, eval, harness, certification, and promotion stack that makes AOR quality-native by default.

**Exit criteria:**
- asset-graph validation covers routes, wrappers, prompt bundles, step policies, datasets, suites, and live E2E profiles
- datasets and evaluation suites are registry-backed and executable through one eval runtime
- harness capture and replay produce normalized evidence that can be compared across changes
- wrapper and route changes can be certified through reusable eval and harness workflows
- promotion decisions are durable artifacts rather than ad hoc release notes

**Detailed slices:** `docs/backlog/wave-3-implementation-slices.md`

## W4 — delivery foundation
**Goal:** Add safe write-back modes, manifests, and release artifacts so AOR can move from rehearsal to controlled delivery.

**Exit criteria:**
- isolated execution supports patch, local branch, and fork-first delivery modes
- write-back policy is explicit and machine-checkable before a delivery run starts
- delivery outputs can be materialized as patches, branches, and PR-ready changesets
- delivery manifests and release packets capture the exact evidence chain for every run
- delivery rehearsal on public targets remains recovery-safe and upstream-safe by default

**Detailed slices:** `docs/backlog/wave-4-implementation-slices.md`

## W5 — operator and live E2E foundation
**Goal:** Expose operator-grade APIs, live views, and standardized live E2E orchestration for the full control plane.

**Exit criteria:**
- the control plane exposes read APIs for project state, packets, runs, and quality evidence
- live run events stream through a stable event model usable by CLI and web surfaces
- CLI and detachable web UI can inspect runs and perform bounded interventions
- standard live E2E profiles execute through the same control plane used by product features
- scorecards, incident capture, and learning-loop outputs are durable artifacts

**Detailed slices:** `docs/backlog/wave-5-implementation-slices.md`

## W6 — command-surface expansion
**Goal:** Expand the control plane from read-only operations into bounded command execution and operational controls.

**Exit criteria:**
- backlog tooling can discover and schedule `W6+` slices without manual script edits
- planned command contracts for intake/discovery/spec/wave are implemented and tested
- run lifecycle controls are implemented with explicit policy and audit traceability
- UI attach/detach lifecycle commands are implemented without breaking headless-first operation
- delivery/release prepare and incident/audit command packs materialize durable artifacts

**Detailed slices:** `docs/backlog/wave-6-implementation-slices.md`

## W7 — MVP+ governance and quality closure
**Goal:** Close remaining MVP+ governance and quality outcomes across certification, finance evidence, and learning-loop control.

**Exit criteria:**
- governance-focused quality checks are executable through one certification/eval path
- AI platform promotion/freeze readiness includes stronger regression evidence and finance linkage
- incident recertification and follow-up handoff flows are contract-backed and runnable
- finance/audit visibility is durable and queryable from the same command and API surfaces

**Detailed slices:** `docs/backlog/wave-7-implementation-slices.md`

## W8 — later maturity closure
**Goal:** Close later-maturity stories with durable operational, governance, and delivery orchestration behavior.

**Exit criteria:**
- strategic sponsor/manager visibility stories are addressed through stable operator surfaces
- later discovery, architecture, and security governance stories are represented in executable flows
- routed execution compiles prompt/context assets into durable compiled-context artifacts and injects adapter-ready context payloads
- context updates are versioned, policy-gated, and promotion-auditable with explicit provenance
- multi-repo and delivery rerun maturity stories are closed with bounded artifacts and policies
- incident and AI platform later-stage recertification loops are replayable and auditable

**Detailed slices:** `docs/backlog/wave-8-implementation-slices.md`

## W9 — post-audit stabilization and execution expansion
**Goal:** Fix audit-discovered bugs and source-of-truth drift first, then reopen bounded platform expansion for detached transport and live routed execution.

**Exit criteria:**
- routed execution evidence is durable per run and no longer overwrites prior same-step artifacts
- repo-entry docs and control-plane docs distinguish current implementation from target architecture accurately
- control-plane API contract coverage is machine-checkable through the shared loader path
- public CLI quality surfaces include harness replay plus asset promote/freeze workflows
- connected web mode can consume a detached HTTP/SSE control-plane transport while headless operation remains supported
- a first supported non-mock adapter can execute live routed work under explicit guardrails

**Detailed slices:** `docs/backlog/wave-9-implementation-slices.md`

## W10 — production-facing execution and delivery proof
**Goal:** Convert the current baselines into externally exercised runtime paths so the backlog once again reflects the remaining work between implementation baseline and production-facing proof.

**Exit criteria:**
- the supported live adapter path invokes an external runner rather than returning an in-process deterministic success envelope
- fork-first delivery can perform bounded GitHub fork/branch/PR draft writes when approvals and credentials are present, while preserving safe planning-only fallbacks
- detached transport supports bounded authenticated mutation commands for connected operator clients
- at least one regression target and one release-shaped target from the catalog have fresh live evidence produced through the external runner and real bounded delivery paths

**Current status note:** `W10-S05` is now closed using the replacement target-backed proof bundles, with the latest black-box closure evidence at `examples/live-e2e/fixtures/w12-s04/w12-s04-evidence-bundle.json`. The closure evidence anchors execution and delivery lineage to cloned target checkouts rather than the AOR workspace.

**Detailed slices:** `docs/backlog/wave-10-implementation-slices.md`

## W11 — target-backed live E2E proof closure
**Goal:** Make standard live E2E truly target-backed, profile-driven, and honest enough to serve as production-facing proof.

**Exit criteria:**
- standard `live-e2e` executes against a cloned target checkout rather than the AOR workspace
- preflight executes machine-readable setup and verification commands from the live E2E profile
- routed live execution invokes the supported external adapter path from the target checkout root
- delivery manifests and release packets anchor repo root and changed paths to the target checkout
- fresh `regress-short` and `release-short` evidence bundles prove the target-backed flow without narrative-only assumptions

**Detailed slices:** `docs/backlog/wave-11-implementation-slices.md`

## W12 — public-surface removal and internal harness conversion
**Goal:** Remove public `live-e2e` CLI and contract surfaces, move rehearsal to repo-maintainer-only tooling, and prove the same target scenarios through an internal installed-user black-box harness.

**Exit criteria:**
- public CLI/help/catalog/contracts no longer expose `live-e2e` command or profile surfaces
- public project-profile examples no longer advertise `live_e2e_defaults`
- internal rehearsal runs execute installed-user style through external `aor` subprocesses rather than direct runtime imports
- refreshed proof bundles and runbooks use the internal black-box harness and no longer depend on removed `aor live-e2e *` commands

**Closure evidence:**
- internal harness: `scripts/live-e2e/run-profile.mjs`
- black-box coverage: `scripts/test/live-e2e-harness.test.mjs`
- refreshed operator runbooks: `docs/ops/live-e2e-standard-runner.md`, `docs/ops/live-e2e-learning-loop.md`, `docs/ops/live-e2e-no-write-preflight.md`
- refreshed proof fixtures: `examples/live-e2e/fixtures/w10-s05/*.json`, `examples/live-e2e/fixtures/w11-s05/*.json`, `examples/live-e2e/fixtures/w12-s04/*.json`, `examples/live-e2e/fixtures/w7-s05/w7-governance-integration-rehearsal.sample.md`

**Detailed slices:** `docs/backlog/wave-12-implementation-slices.md`

## W13 — catalog-backed full-journey live E2E and quality verdict expansion
**Goal:** Add a full user-journey live E2E layer on curated public repositories, start each run from a concrete feature mission, and evaluate runtime success plus discovery, artifact, code, delivery, and learning-loop quality through public surfaces.

**Exit criteria:**
- machine-readable target and mission catalog exists under `scripts/live-e2e/catalog/` and stays aligned with `docs/ops/live-e2e-target-catalog.md`
- `aor project init` can bootstrap a clean target repo without harness-side asset injection
- `aor intake create` and `aor discovery run` can materialize and trace feature-specific mission input
- `aor run start` launches real execution runs rather than control-state-only transitions
- public `review run` and `learning handoff` surfaces produce durable `review-report`, `learning-loop-scorecard`, and `learning-loop-handoff` artifacts
- internal live E2E harness supports a mandatory full-journey layer that runs only on curated repos and curated missions
- restored `live-e2e-runner` skill can prepare the feature request, run the public flow, and return a multi-axis verdict matrix

**Detailed slices:** `docs/backlog/wave-13-implementation-slices.md`

## W14 — live E2E scenario/provider/feature-size matrix
**Goal:** Turn curated full-journey live E2E into a matrix across scenario family, pinned provider variant, and size-classed feature missions while keeping the matrix curated rather than Cartesian-complete.

**Exit criteria:**
- curated live E2E catalogs define scenario policies, provider variants, and target missions with explicit `small`, `medium`, and `large` size classes
- full-journey profiles pin `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id`
- the live harness rejects invalid matrix cells and materializes deterministic provider-pinned route overrides for accepted cells
- review, audit, summary, and learning-loop artifacts preserve matrix-cell metadata plus feature-size/provider execution verdicts
- operator docs, runner skill guidance, tests, and proof bundles describe live E2E as a curated matrix with required repo-specific coverage cells

**Detailed slices:** `docs/backlog/wave-14-implementation-slices.md`

**Current status note:** `W14-S07` is now closed with matrix-aware proof under `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json`. The refreshed bundle proves all `9/9` required matrix cells, all `3/3` repo-level `openai-primary` / `anthropic-primary` provider-comparison pairs, and all mandatory scenario families (`regress`, `release`, `repair`, `governance`).

## Planning rule
The roadmap is tracked as **wave → epic → slice → local task**. Shared backlog docs hold waves, epics, and slices. Local tasks live inside the owning wave document and can be refined branch-locally without creating new shared backlog items unless the scope becomes a new independently acceptable outcome.
