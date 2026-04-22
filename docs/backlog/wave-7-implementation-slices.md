# W7 implementation slices

## Wave objective
Make runtime context assets and the compiler quality-native, promotion-aware, and incident-safe.

## Wave exit criteria
- reference integrity and compatibility checks cover route, wrapper, prompt, context, policy, adapter, and compile graphs
- eval and harness workflows can compare context bundles and compiler variants against stable baselines
- promotion, freeze, and demotion of context assets are driven by evidence rather than ad hoc rollout decisions
- incidents and drift handling force recertification with compile-lineage traceability
- live E2E and learning-loop artifacts capture context lineage end to end

## Parallel start and sequencing notes
- `W7-S01` establishes the compatibility model required by the rest of the wave.
- `W7-S03` depends on both evidence generation and compatibility validation; do not design lifecycle transitions without those foundations.
- `W7-S05` closes the wave only after quality, promotion, and incident semantics all agree on compile lineage.

---

## W7-S01 — Validation and compatibility graph for context assets
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Extend validation so prompt/context graphs fail deterministically when bundles, predicates, or step/packet compatibility are invalid.
- **Primary modules:** `packages/contracts`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/context/**`
- **Hard dependencies:** W6-S04, W6-S06
- **Primary user-story surfaces:** architect / tech lead, reviewer / QA, security / compliance

### Local tasks
1. Add reference-integrity checks for prompt, context, policy, adapter, compile graphs, and the new `project-profile.default_prompt_bundles` / `default_context_bundles` refs.
2. Validate bundle composition, predicate semantics, step-class compatibility, compiled-artifact references, and packet-family compatibility.
3. Document compatibility failures and repair expectations.
4. Add deterministic tests for valid and invalid context graphs.

### Acceptance criteria
1. Validation covers the full prompt/context graph rather than only route/wrapper/policy references, including project-profile-owned prompt/context defaults.
2. Invalid context composition fails before adapter invocation.
3. Compatibility rules are documented with reproducible failure examples for compiled artifacts and packet-family mismatch.
4. Tests cover bundle composition, predicate mismatch, incompatible packet inputs, and broken default prompt/context refs.

### Done evidence
- reference-integrity tests for context assets
- contract docs for compatibility rules
- failure fixtures for invalid graph combinations

### Out of scope
- promotion lifecycle changes
- live-e2e integration updates

---

## W7-S02 — Eval and harness coverage for context candidates
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Compare candidate context bundles and compiler variants against stable baselines using eval and harness evidence instead of narrative judgment.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W7-S01, W6-S05
- **Primary user-story surfaces:** reviewer / QA, AI platform owner

### Local tasks
1. Extend eval and harness inputs so suites can compare context bundles, compiler revisions, and compiled hashes.
2. Define candidate versus stable evidence semantics for compiled-context subjects, including selected docs/rules/skills and dropped-input behavior.
3. Add fixtures and examples for baseline, candidate, and drifted context runs with compiled output metadata.
4. Add regression tests for evidence comparison and replay behavior.

### Acceptance criteria
1. Eval and harness flows can compare context candidates against stable baselines.
2. Evidence outputs include the context bundle, compiler revision, compiled hashes, selected docs/rules/skills, and dropped inputs under test.
3. Example suites and captures show candidate-versus-stable behavior explicitly at both resolved-asset and compiled-output layers.
4. Tests cover replay, regression detection, baseline mismatch, and dropped-input drift paths.

### Done evidence
- updated eval suites and harness fixtures
- comparison artifacts for context candidate versus stable runs
- tests for replay and baseline comparison

### Out of scope
- promotion lifecycle decisions
- operator-facing visualization work

---

## W7-S03 — Promotion, freeze, and demotion lifecycle for context assets
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Make context assets and compiler revisions first-class promotion subjects with evidence-backed promotion, freeze, and demotion semantics.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `apps/cli`
- **Hard dependencies:** W7-S01, W7-S02
- **Primary user-story surfaces:** AI platform owner, finance / audit / hygiene

### Local tasks
1. Extend promotion decisions to cover prompt bundles, context bundles, and compiler revisions as separate promotion subjects.
2. Bind promotion, freeze, and demotion outcomes to compile evidence and baseline-comparison results for each promotion subject.
3. Update CLI and contract surfaces for context-lifecycle operations.
4. Add tests for promote, hold, freeze, and demote flows.

### Acceptance criteria
1. Prompt bundles, context bundles, and compiler revisions can each be promoted, frozen, or demoted through first-class decisions.
2. Decisions require linked eval/harness evidence rather than narrative approval.
3. CLI and contract docs match lifecycle behavior for each compiled-context promotion subject.
4. Tests cover promote, hold, freeze, demote, and recertify-needed paths for prompt, context, and compiler subjects.

### Done evidence
- promotion decision fixtures for context assets
- CLI/runtime tests for lifecycle transitions
- contract docs for context lifecycle semantics

### Out of scope
- incident-triggered recertification workflows
- later-wave operator visibility

---

## W7-S04 — Incident recertification and drift governance
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Force recertification when incidents or drift implicate context assets, compiler revisions, or packet/context mismatches.
- **Primary modules:** `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W7-S03, W6-S06
- **Primary user-story surfaces:** incident / improvement owner, operator / SRE, AI platform owner

### Local tasks
1. Add drift classifications for asset drift, compile drift, packet drift, and policy drift using compiled artifact lineage as the source of truth.
2. Link incident handling and recertification requirements to context lifecycle state and compiled-artifact evidence.
3. Update ops docs and runbooks for drift-triggered recertification.
4. Add tests for blocked re-enable and required recertification paths.

### Acceptance criteria
1. Drift causes are explicit and durable in runtime evidence and point back to compiled artifact lineage.
2. Incidents can force recertification of context assets and compiler revisions before reuse.
3. Runbooks define when re-enable is blocked versus allowed.
4. Tests cover asset drift, compile drift, packet drift, and policy drift cases.

### Done evidence
- incident and drift fixtures with compile-lineage refs
- runbooks for drift-triggered recertification
- tests covering blocked and approved recovery paths

### Out of scope
- strategic reporting surfaces
- multi-repo recovery flows

---

## W7-S05 — Live E2E context-lineage integration closure
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Close W7 by making rehearsal profiles, scorecards, and learning-loop artifacts context-lineage aware end to end.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`, `docs/backlog/**`
- **Hard dependencies:** W7-S02, W7-S03, W7-S04
- **Primary user-story surfaces:** incident / improvement owner, AI platform owner, operator / SRE

### Local tasks
1. Update rehearsal profiles and scorecards to record compiled-context lineage instead of relying on the old `asset_resolution` trace.
2. Align learning-loop handoff artifacts with context candidate/stable decisions.
3. Add an integrated W7 rehearsal path that exercises validation, promotion, and incident recertification together on compile-lineage artifacts.
4. Add wave-level verification for the integrated lineage-aware flow.

### Acceptance criteria
1. Live E2E artifacts expose prompt/context lineage consistently.
2. Scorecards and learning-loop handoffs link incidents back to context and compiler evidence.
3. Integrated W7 rehearsal exercises the full context-quality loop on compile-lineage artifacts rather than the old `asset_resolution` shape.
4. Wave-level verification passes with durable lineage-aware artifacts.

### Done evidence
- live-e2e profiles and scorecards with context lineage
- integrated W7 rehearsal transcript
- backlog and ops notes for W7 closure evidence

### Out of scope
- later-wave strategic operator dashboards
- non-local environment automation
