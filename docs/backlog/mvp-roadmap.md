# MVP roadmap

The authoritative planning model for implementation lives in:
- `docs/backlog/backlog-operating-model.md`
- `docs/backlog/mvp-implementation-backlog.md`
- `docs/backlog/orchestrator-epics.md`
- `docs/backlog/slice-dependency-graph.md`
- the wave documents `docs/backlog/wave-0-implementation-slices.md` through `docs/backlog/wave-8-implementation-slices.md`

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
| W8 | Close later-maturity stories for strategic operator visibility, governance hardening, and multi-repo delivery maturity. | 7 | EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-8-implementation-slices.md` |

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
- multi-repo and delivery rerun maturity stories are closed with bounded artifacts and policies
- incident and AI platform later-stage recertification loops are replayable and auditable

**Detailed slices:** `docs/backlog/wave-8-implementation-slices.md`

## Planning rule
The roadmap is tracked as **wave → epic → slice → local task**. Shared backlog docs hold waves, epics, and slices. Local tasks live inside the owning wave document and can be refined branch-locally without creating new shared backlog items unless the scope becomes a new independently acceptable outcome.
