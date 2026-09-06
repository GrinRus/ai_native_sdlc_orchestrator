# W71-S14 UI-refactor integration, installed closure, and freeze execution plan

## Task contract

- Outcome: integrate the sibling Command Desk UI commit with the repaired
  runtime/control-plane `main`, then produce immutable installed black-box and
  qualification-freeze evidence for W71.
- Scope: the sibling UI handoff `59943bfa`, minimal client/runtime wiring only
  when required by contract drift, installed browser/control-plane journeys,
  package/install smoke, evidence/story disposition, and W66 freeze inputs.
- Out of scope: redesigning the sibling UI, paid provider execution, changing
  server-owned lifecycle semantics, upstream writes, or claiming fresh W66
  provider qualification.
- Acceptance: the merged product preserves server-owned Task truth; no-write,
  patch/recovery/Ask AOR, and two-repository flows are proven through public
  installed surfaces; UI accessibility/responsive/keyboard/offline checks pass;
  evidence resolves to immutable bytes; and the freeze explicitly remains
  blocked only by the fresh provider matrix.

## Neighbor UI coordination

- Sibling task: `Улучшить UI и UX`
  (`01a061b2-119a-7272-91d0-13add13d75c2`), checkout
  `/Users/griogrii_riabov/grigorii_projects/ai_native_sdlc_orchestrator`.
- Immutable handoff: `59943bfaa7af0c97b1eff38e7093aced069d0fb9`,
  `feat(web): align command desk target geometry`, local branch
  `codex/command-desk-ui`.
- Coordination mode: `merge-first`. The handoff is a UI-only commit whose
  parent is outside current `main`; integrate the exact commit and review the
  resulting diff before any UI acceptance claim. Do not merge the entire stale
  sibling branch or overwrite current runtime/contracts.

## Implementation plan

1. Record the merge-base and cherry-pick the exact immutable UI commit onto a
   fresh S14 branch; resolve only contract-compatible conflicts and inspect all
   changed paths for accidental runtime or provider coupling.
2. Run focused web unit/build/lint/type checks and the existing closure browser
   tests against the merged build. Recheck desktop, mobile, 200% zoom,
   keyboard/focus, reduced-motion, offline/reconnect, overflow, and console
   error evidence.
3. Execute installed no-write Task, patch/recovery/Ask AOR, and public
   two-repository journeys from a neutral launcher and isolated AOR Home; keep
   target repositories unchanged and collect reload-safe action journals and
   digest-addressed artifacts.
4. Re-run reference, adversarial, package/install, and production-readiness
   gates against the final candidate; promote stories only to the strongest
   evidenced tier and leave fresh provider qualification unresolved.
5. Freeze source/target/profile/UI/proof identities, record residual W66
   blocker ownership, commit and review the implementation, merge its PR, then
   record S14 closure evidence in a separate documentation PR.

## Verification

- `pnpm test:web:browser`
- `pnpm test:references`, `pnpm lint`, `pnpm typecheck`, `pnpm quality:ratchet`
- `pnpm w66:proof`
- `pnpm release:pack`, `pnpm release:smoke`
- `pnpm production:ready --json`
- `pnpm slice:gate`
- `pnpm test` with the final execution manifest at `114/114`

## Exit condition

S14 may be marked done only after the merged installed proof and immutable
freeze manifest are present. A blocked readiness result is acceptable only when
it identifies the external W66-S09 provider quota/matrix as the remaining
release blocker and contains no stale UI or W71 source-of-truth claim.
