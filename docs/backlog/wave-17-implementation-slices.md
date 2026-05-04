# W17 implementation slices

## Wave objective
Close the post-W16 legacy cleanup by removing public compatibility aliases and stale documentation that were intentionally left out of the behavior-preserving decomposition wave.

## Wave exit criteria
- W17 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- public CLI output no longer emits the legacy incident path alias
- delivery mode inputs accept only canonical `no-write`, `patch-only`, `local-branch`, and `fork-first-pr` values
- adapter permission legacy wording remains only in explicit unsupported/negative-test contexts
- docs, examples, profiles, and fixtures no longer advertise legacy public aliases

## Sequencing notes
- `W17-S01` depends on the W16 decomposition and adapter cleanup slices so the cleanup can touch the split CLI, core, live E2E runner, and permission-policy modules directly.
- `W15-S04` remains externally blocked and is not part of W17 cleanup scope.

---

## W17-S01 — Legacy surface cleanup after W16
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Remove public compatibility aliases and stale legacy documentation after W16 while keeping the current canonical CLI, delivery, and adapter permission surfaces explicit.
- **Primary modules:** `docs/backlog/**`, `apps/cli`, `packages/orchestrator-core`, `scripts/live-e2e/**`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`, `examples/**`, tests
- **Hard dependencies:** W16-S02, W16-S04, W16-S05, W16-S06
- **Primary user-story surfaces:** operator / SRE, delivery transaction / Git / PR flow, incident / improvement owner, security / compliance

### Local tasks
1. Add W17-S01 across backlog source-of-truth docs without reopening W16 or W15-S04.
2. Remove the legacy incident path alias from public CLI outputs, command catalog docs, live E2E readers, tests, and proof fixtures.
3. Remove delivery mode alias support and update examples/profiles to canonical mode values.
4. Clean adapter permission legacy fixture wording while preserving explicit negative coverage for unsupported `external_runtime.args`.
5. Run targeted regressions and root gates, then mark W17-S01 done.

### Acceptance criteria
1. `pnpm slice:status` reports W17-S01 consistently while active and returns to only the external W15-S04 blocker after completion.
2. The legacy incident path alias is absent from tracked source, docs, tests, and examples.
3. Legacy delivery aliases are absent from active mode fields and are rejected instead of normalized.
4. `external_runtime.args` appears only in unsupported contract or negative-test contexts.
5. `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`, and `pnpm slice:gate` pass.

### Done evidence
- synchronized W17-S01 entries across backlog docs
- updated canonical CLI, delivery mode, and live E2E surfaces
- regression search evidence for removed aliases
- passing targeted and root gates

### Out of scope
- producing the externally blocked W15-S04 real code-changing proof
- changing `mock-runner` dry-run semantics
- adding new delivery modes or adapter providers
