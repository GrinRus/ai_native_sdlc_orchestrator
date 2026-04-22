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
| W6 | Rebaseline post-MVP delivery around first-class runtime context, compiled prompt/context assembly, and legacy removal. | 6 | EPIC-0, EPIC-1, EPIC-3 | `docs/backlog/wave-6-implementation-slices.md` |
| W7 | Make runtime context quality-native with validation, promotion, drift control, and live-e2e evidence. | 5 | EPIC-4, EPIC-7 | `docs/backlog/wave-7-implementation-slices.md` |
| W8 | Rebuild later-maturity operator, delivery, and multi-repo flows on compiled-context foundations. | 7 | EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-8-implementation-slices.md` |

## Post-MVP story allocation
| Slice ID | Story IDs / closure notes |
|---|---|
| W6-S01 | enablement slice (no direct story closure) |
| W6-S02 | ARC-06, PBO-06, PBO-07, runtime context asset foundation |
| W6-S03 | DEV-09, SEC-05, AIP-07 |
| W6-S04 | DIS-07, EMP-07, OPS-09 |
| W6-S05 | PSO-07, DEV-08, RMO-05 |
| W6-S06 | enablement slice (legacy/runtime-context convergence) |
| W7-S01 | ARC-07, RQA-05, FIN-07 |
| W7-S02 | AIP-08, AIP-09, AIP-10, FIN-05 |
| W7-S03 | AIP-07, context promotion and freeze lifecycle |
| W7-S04 | INC-04, asset and compiler drift governance |
| W7-S05 | integration closure (wave-level evidence) |
| W8-S01 | PSO-08, EMP-08 |
| W8-S02 | DIS-08, ARC-08, PBO-08 |
| W8-S03 | DEV-10, SEC-06, DTX-08 |
| W8-S04 | OPS-10 |
| W8-S05 | RQA-06, AIP-11 |
| W8-S06 | INC-06, AIP-12, FIN-08 |
| W8-S07 | RMO-06, multirepo context and rerun maturity |

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

## W6 — runtime context foundation
**Goal:** Introduce a first-class runtime context foundation for compiled prompt/context flows across every step class and remove AGENTS/legacy leakage from the runtime model.

**Exit criteria:**
- backlog, roadmap, epic map, and dependency graph consistently distinguish development guidance from runtime context
- runtime context asset families and registry roots are contract-defined and referenced by project profiles
- prompt/context compilation is deterministic and no longer owned by wrapper profiles
- routed execution, project analysis, step results, and harness captures carry prompt/context lineage through the dry-run/mock execution path
- all step classes consume compiled prompt/context inputs and runtime references to `AGENTS.md`, `.agents/**`, and legacy aliases are removed

**Detailed slices:** `docs/backlog/wave-6-implementation-slices.md`

## W7 — runtime context quality and drift control
**Goal:** Make runtime context assets and the compiler quality-native, promotion-aware, and incident-safe.

**Exit criteria:**
- reference integrity and compatibility checks cover route, wrapper, prompt, context, policy, adapter, and compile graphs
- eval and harness workflows can compare context bundles and compiler variants against stable baselines
- promotion, freeze, and demotion of context assets are driven by evidence rather than ad hoc rollout decisions
- incidents and drift handling force recertification with compile-lineage traceability
- live E2E and learning-loop artifacts capture context lineage end to end

**Detailed slices:** `docs/backlog/wave-7-implementation-slices.md`

## W8 — compiled-context maturity expansion
**Goal:** Rebuild later-maturity operator, delivery, and multi-repo flows on top of compiled-context foundations.

**Exit criteria:**
- operator surfaces expose selected prompt/context assets, compile hashes, dropped inputs, and policy reasoning
- later discovery, bootstrap, delivery, and security flows consume AOR-native runtime context rather than repository-local guidance files
- baseline comparison and platform recertification flows can compare context bundles, compiler revisions, and resolved docs/rules/skills
- multi-repo and rerun orchestration use repo-aware compiled-context scope with bounded artifacts and audit traces

**Detailed slices:** `docs/backlog/wave-8-implementation-slices.md`

## Planning rule
The roadmap is tracked as **wave → epic → slice → local task**. Shared backlog docs hold waves, epics, and slices. Local tasks live inside the owning wave document and can be refined branch-locally without creating new shared backlog items unless the scope becomes a new independently acceptable outcome.
