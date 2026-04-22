# W6 implementation slices

## Wave objective
Introduce a first-class runtime context foundation for compiled prompt/context flows across every step class and remove AGENTS/legacy leakage from the runtime model.

## Wave exit criteria
- backlog, roadmap, epic map, and dependency graph consistently distinguish development guidance from runtime context
- runtime context asset families and registry roots are contract-defined and referenced by project profiles
- prompt/context compilation is deterministic and no longer owned by wrapper profiles
- routed execution, project analysis, step results, and harness captures carry prompt/context lineage through the dry-run/mock execution path
- all step classes consume compiled prompt/context inputs and runtime references to `AGENTS.md`, `.agents/**`, and legacy aliases are removed

## Parallel start and sequencing notes
- `W6-S01` lands first because the rest of W6 depends on the rebased planning model and terminology.
- `W6-S02` must close before compiler work starts; do not build a context compiler against the old wrapper-owned prompt model.
- insert an explicit architecture review checkpoint after `W6-S02` closes and before `W6-S03` starts; confirm the singular ownership model for route, wrapper, prompt, and context before compiler implementation begins.
- `W6-S06` lands last so legacy removal happens only after compiled-context flow integration is real across all step classes.
- W6 proves compiled-context injection only through dry-run/mock adapter paths; live provider-backed execution remains out of scope for this wave.

---

## W6-S01 — Backlog and runtime-context terminology rebaseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Rebaseline W6-W8 shared planning around runtime context management and close the drift between implemented tooling and shared backlog language.
- **Primary modules:** `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `examples/project-analysis-report.sample.yaml`
- **Hard dependencies:** W5-S06
- **Primary user-story surfaces:** architect / tech lead, engineering manager / planner, repository / multirepo owner

### Local tasks
1. Rewrite `mvp-roadmap`, `mvp-implementation-backlog`, `orchestrator-epics`, `slice-dependency-graph`, and the `W6-W8` wave docs around runtime context management instead of command-pack expansion.
2. Update product and architecture source-of-truth docs to separate repository-development guidance from runtime context.
3. Remove AGENTS-centric runtime language from project-analysis samples and supporting docs.
4. Prove that slice tooling still parses the rebased backlog and selects the correct next slice.

### Acceptance criteria
1. Shared backlog docs agree on W6-W8 objectives, slice titles, hard dependencies, and wave exit criteria.
2. Product and architecture docs state that `AGENTS.md` and `.agents/**` are development-only guidance and not runtime inputs.
3. The project-analysis sample no longer recommends AGENTS-style runtime guidance.
4. `pnpm slice:status` and `pnpm slice:next -- --json` stay coherent after the rebaseline.
5. `pnpm slice:gate` passes with the rebased planning model.

### Done evidence
- rebased `docs/backlog/**` planning set for W6-W8
- updated product and architecture docs for runtime-context terminology
- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:gate`

### Out of scope
- implementation of runtime context contracts or compiler logic
- adapter-envelope or step-result schema changes

---

## W6-S02 — Context asset contracts and registry foundation
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Define versioned runtime context asset families, committed registry roots, and a single ownership model for route, wrapper, prompt, and context defaults so project profiles become the only default source for runtime asset selection.
- **Primary modules:** `docs/contracts/**`, `packages/contracts`, `packages/orchestrator-core`, `examples/context/**`
- **Hard dependencies:** W6-S01
- **Primary user-story surfaces:** architect / tech lead, project bootstrap / onboarding, AI platform owner

### Local tasks
1. Add contract families for `context-doc`, `context-rule`, `context-skill`, `context-bundle`, and `compiled-context-artifact`.
2. Extend project-profile contracts with committed asset roots plus `default_prompt_bundles` and `default_context_bundles` alongside the existing wrapper defaults.
3. Remove `provider-route-profile.wrapper_profile_ref`, `wrapper.prompt_bundle_ref`, and `wrapper.session_bootstrap` from the target contract model and document the new ownership boundaries.
4. Add example assets under committed AOR roots and wire the new project-profile refs plus context families into contract-loader and reference-integrity coverage.

### Acceptance criteria
1. The new context asset families are defined in source-of-truth contracts with committed example coverage.
2. Project profiles can deterministically resolve wrapper, prompt, and context defaults without route-owned wrapper refs or wrapper-owned prompt refs.
3. Loader and reference-integrity coverage can resolve the new project-profile refs and context asset graph from committed asset roots without treating legacy fields as supported runtime shape.
4. Committed examples cover `context-doc`, `context-rule`, `context-skill`, `context-bundle`, and `compiled-context-artifact`.
5. No runtime contract requires `AGENTS.md` or `.agents/**` as a context source.

### Done evidence
- new context contract docs and examples
- loader/reference-integrity coverage updates for context assets and new project-profile refs
- project-profile examples referencing default prompt/context bundles

### Out of scope
- prompt/context compilation logic
- adapter-envelope changes
- live adapter execution

---

## W6-S03 — Prompt/context compiler kernel
- **Epic:** EPIC-3 Routed execution
- **State:** ready
- **Outcome:** Add a deterministic compiler kernel that assembles prompt bundles, selected runtime context assets, packet refs, and project-analysis facts into one bounded runtime artifact and owns compile policy.
- **Primary modules:** `packages/context-engine`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W6-S02
- **Primary user-story surfaces:** AI platform owner, delivery engineer, security / compliance

### Local tasks
1. Introduce `packages/context-engine` as the single compile point for prompt/context assembly.
2. Formalize compile precedence across prompt bundle, always-on rules, predicate-selected docs/skills, packet refs, and project-analysis facts.
3. Define deterministic budgeting, truncation, hash inputs, and the shape of `dropped_inputs`, then emit compiled-context artifacts with hashes, dropped inputs, budget decisions, and provenance refs.
4. Document compiler semantics, fail-fast conditions for missing required packet/context sources, and the explicit exclusion of `AGENTS.md` and `.agents/**` from compile inputs.

### Acceptance criteria
1. A shared compiler kernel exists and is the only supported path for prompt/context assembly and compile policy.
2. The compile pipeline is deterministic for identical inputs and selections, including identical `compiled_prompt`, `compiled_context`, `prompt_hash`, and `context_hash`.
3. Compiled-context artifacts persist selected assets, packet refs, dropped inputs, budget decisions, hashes, and provenance.
4. Architecture and contract docs explain compile order, budgeting/truncation, hash inputs, and fail-fast conditions.
5. Compiler inputs are limited to AOR-owned runtime assets, packet refs, and project-analysis facts; `AGENTS.md` and `.agents/**` are not compile sources.

### Done evidence
- `packages/context-engine`
- compile artifact examples and determinism tests
- architecture docs for prompt/context compilation and compile policy

### Out of scope
- step-execution integration
- all-step-class adoption

---

## W6-S04 — Routed execution integration for compiled context
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Rewire routed execution so project analysis, step execution, adapter envelopes, and harness captures all carry compiled prompt/context lineage on the dry-run/mock execution path.
- **Primary modules:** `packages/orchestrator-core`, `packages/adapter-sdk`, `packages/harness`, `docs/contracts/**`
- **Hard dependencies:** W6-S02, W6-S03
- **Primary user-story surfaces:** engineering manager / planner, delivery engineer, operator / SRE

### Local tasks
1. Update asset loading so project-profile owns wrapper/prompt/context defaults and prompt selection is independent from wrapper ownership.
2. Call the context compiler before adapter invocation and extend the adapter request envelope with explicit `prompt_resolution`, `compiled_prompt`, `compiled_context_ref`, `compiled_context_summary`, and real `input_packet_refs`.
3. Split project-analysis reporting into `prompt_resolution` and `context_resolution`, then extend step results and harness compatibility with prompt bundle refs, context bundle refs, compiler revision, and prompt/context hashes.
4. Remove the old `asset_resolution` shape as the only execution trace and add tests for compiled-context injection, lineage persistence, and failure handling.

### Acceptance criteria
1. Routed execution no longer depends on wrapper-owned prompt selection or route-owned wrapper refs.
2. Adapter requests in dry-run carry compiled prompt/context data and real packet refs.
3. Project-analysis exposes compile-readiness through explicit `prompt_resolution` and `context_resolution` rather than only wrapper/prompt registry layout.
4. Step-result and harness artifacts expose prompt/context lineage, and harness replay compares compile lineage rather than only `route/wrapper/prompt/policy/adapter`.
5. Tests cover compiled-context success, missing-asset failure, lineage persistence, and dry-run adapter-envelope shaping.

### Done evidence
- updated routed execution and adapter-envelope tests
- step-result and harness examples with compile lineage and compatibility fields
- project-analysis examples showing prompt/context readiness

### Out of scope
- live adapter execution
- provider-specific session wiring
- operator/API visibility beyond artifact persistence
- later-wave delivery/security maturity

---

## W6-S05 — All-step-class compiled-context flow integration
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Run the compiled-context model through discovery, research, spec, planning, implement, review, QA, repair, eval, and harness flows with explicit per-step compile input contracts so packets and project analysis become real runtime inputs.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `apps/api`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W6-S04
- **Primary user-story surfaces:** discovery / research, engineering manager / planner, reviewer / QA, repository / multirepo owner, delivery engineer

### Local tasks
1. Thread compiled-context resolution through every supported step class.
2. Document packet/context requirements for each supported step class, including where project-analysis facts are mandatory versus optional.
3. Replace side metadata with real packet and project-analysis inputs for the compiler and align all step classes to one compile-contract vocabulary.
4. Rebase future command assumptions and flow docs on the compiled-context model, then add end-to-end tests that cover all step classes from analyze through routed dry-run.

### Acceptance criteria
1. Every supported step class resolves prompt/context through the shared compiler path.
2. Every supported step class has a documented compile input matrix that names packet/context requirements and project-analysis expectations.
3. Packet refs and project-analysis facts are actual runtime inputs rather than detached metadata.
4. Flow and command docs no longer describe the old wrapper/bootstrap context model.
5. End-to-end tests cover all step classes on the compiled-context foundation.

### Done evidence
- all-step-class execution tests
- documented compile input matrix for all supported step classes
- updated architecture docs for step-class integration
- routed dry-run artifacts with compiled-context refs

### Out of scope
- legacy cleanup
- later-wave operator and delivery maturity

---

## W6-S06 — Legacy purge and fixture migration
- **Epic:** EPIC-0 Repository development system
- **State:** blocked
- **Outcome:** Remove legacy runtime aliases, AGENTS-based runtime references, and obsolete fixture shapes so the compiled-context model becomes the only supported runtime path and old shapes are explicitly rejected.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `packages/harness`, `examples/**`, `docs/contracts/**`
- **Hard dependencies:** W6-S04, W6-S05
- **Primary user-story surfaces:** repository / multirepo owner, incident / improvement owner, AI platform owner

### Local tasks
1. Remove legacy delivery aliases and old route/wrapper/prompt refs from validators, examples, fixtures, contract-loader coverage, runtime code, and docs.
2. Remove runtime references to `AGENTS.md` and `.agents/**` from contracts, examples, fixtures, and tests.
3. Regenerate live-e2e fixtures, harness captures, and examples to the compiled-context shape.
4. Add explicit rejection paths for old or foreign compile-lineage artifacts.

### Acceptance criteria
1. Legacy aliases and compatibility shims are removed from supported runtime contracts, validator coverage, and code paths.
2. No runtime example, fixture, or contract treats `AGENTS.md` or `.agents/**` as runtime context.
3. Harness and replay flows reject obsolete capture shapes without compile lineage instead of silently ignoring them.
4. Old legacy contract refs do not pass supported runtime validation.
5. Fixture regeneration and regression tests pass on the new runtime model only.

### Done evidence
- regenerated fixtures and examples
- legacy-removal diffs in contracts/runtime code and validator coverage
- replay and regression tests proving old shapes are rejected

### Out of scope
- later-wave visibility or delivery maturity features
- preserving backwards compatibility for deprecated runtime shapes
