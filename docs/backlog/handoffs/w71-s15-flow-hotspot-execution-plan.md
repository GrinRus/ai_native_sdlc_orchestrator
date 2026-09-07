# W71-S15 live-E2E flow hotspot execution plan

## Task contract

- Outcome: lower the change radius of `scripts/live-e2e/lib/flows.mjs` by
  extracting the artifact-consistency responsibility behind a stable internal
  interface, with byte/shape/error behavior unchanged.
- In scope: the extracted artifact-consistency module, its characterization
  tests, the flow import seam, measured quality baseline, and W71-S15 evidence.
- Out of scope: live provider/profile/policy behavior, web/UI files,
  step-execution or CLI hotspots, and any unrelated contract redesign.
- Acceptance: `flows.mjs` is below its approved S12 ceiling; extracted module
  has one-way imports; positive and negative artifact parity tests pass; the
  quality ratchet records reduced size/complexity without new clone or cycle
  debt; remaining hotspots become separately measured follow-ups.

## UI coordination

The neighboring UI task is `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`)
on `codex/command-desk-ui`, latest immutable commit `59943bfa`. Its merged
Command Desk changes and browser evidence are complete. S15 uses `mode:
no-overlap`: no `apps/web/**` or UI fixtures are edited. Re-check the thread
before each later slice; any shared-contract overlap requires `contract-handoff`
and the UI commit must be merged first (`merge-first`).

## Implementation plan

1. Freeze the current artifact-consistency behavior by capturing equivalent
   matrix/coverage fields and a mutated learning-handoff failure.
2. Move `sortJsonValue`, comparison helpers, and
   `evaluateArtifactConsistency` into `artifact-consistency.mjs`, importing only
   neutral common utilities; retain the existing call site and public flow
   exports.
3. Add focused characterization tests and inspect the import graph for cycles
   or provider-specific edges.
4. Run quality metrics before/after, lower the `flows.mjs` ceiling below the
   S12 exception, and leave other measured hotspots as explicit successor work.
5. Commit/push implementation, review CI, merge, sync `main`, then record S15
   closure evidence in a separate documentation PR.

## Verification

- `node --test scripts/live-e2e/test/artifact-consistency.test.mjs`
- the existing live-E2E proof-runner/flow characterization tests
- `pnpm lint`, `pnpm typecheck`, `pnpm quality:ratchet`
- `node scripts/readiness/w71-disposition.mjs`
- `pnpm slice:gate` / Node 22 CI
