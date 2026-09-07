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
  patch/recovery/Ask AOR, and the installed control-plane boundary are proven
  through public surfaces; UI accessibility/responsive/keyboard/offline checks
  pass; evidence resolves to immutable bytes; and any missing two-repository
  provision-to-delivery coverage is recorded as an explicit S14 blocker rather
  than promoted to a pass.

## Neighbor UI coordination

- Sibling task: `Улучшить UI и UX`
  (`01a061b2-119a-7272-91d0-13add13d75c2`), checkout
  `/Users/griogrii_riabov/grigorii_projects/ai_native_sdlc_orchestrator`.
- Immutable handoff: `59943bfaa7af0c97b1eff38e7093aced069d0fb9`,
  `feat(web): align command desk target geometry`, already merged to `main`.
- Coordination mode: `merge-first` satisfied, then `no-overlap` for the
  remaining S14 work. The sibling branch is evidence only; do not edit
  UI-owned paths or overwrite current runtime/contracts.

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

## Execution record

- UI handoff was integrated as the exact immutable sibling commits listed
  above; no stale sibling branch was merged.
- The real same-origin app was launched from a neutral directory with a
  disposable `AOR_HOME`. Public control-plane journeys covered no-write and
  patch-only preparation, revision-aware route readback, route persistence
  across reload, readiness recovery, durable Ask AOR, a successful second
  repository connection, and the Task `discovery-run` lifecycle action. The
  second-repository evidence stops at connection/provisioning; a complete
  two-repository provision → conflict/retry → integration → delivery/cleanup
  run is not yet proven.
- Browser checks used the running app without API route fulfilment: desktop
  keyboard focus, 390x844 mobile overflow, 200% zoom overflow, reduced-motion
  emulation, zero console errors, and zero POSTs during read/reload checks.
- The immutable record is
  `docs/research/27-w71-s14-installed-control-plane-evidence.json`.
- The runtime/control-plane candidate commit represented by the freeze is
  `4906ca6a250ac314206068b3d85f44a604ea024e`; its fresh 16-case adversarial
  proof is
  `sha256:cf0c5c3efac571ba87bd1e89ef0b4653be35519cc6669022c59e7da8fab88997`,
  and its same-commit qualification manifest is
  `sha256:7755a5a3cbbbba025cdc6d19b9284e962d58f34bd822d68b26cb2958d92882ad`.
  The durable review decision and learning handoff passed. The historical
  run-health record still contains the earlier missing-review-decision failure
  and diagnostic warning; it was not rewritten or used as fresh provider proof.
- Package/browser checks previously passed on the merged UI baseline. The
  current diagnostic remains non-green because of retry timing and missing
  local Playwright browser executables; no provider rerun is claimed.

## Exit condition

S14 may be marked done only after the merged installed proof and immutable
freeze manifest are present **and** the public two-repository
provision-to-integration-to-delivery journey is closed. The current
integrated-local evidence is valid for the no-write/control-plane boundary and
is intentionally partial; W71-AUD-006 through W71-AUD-008 remain open. The
slice is also release-blocked until the separately authorized W66-S09 provider
matrix is available. Readiness must identify both the open S14 coverage and
the external provider hold without stale UI or W71 source-of-truth claims.
