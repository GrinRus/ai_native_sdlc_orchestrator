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
  pass; evidence resolves to immutable bytes; and the installed two-repository
  provision-to-delivery journey is closed without upstream writes.

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
  installed public two-repository closure is now reproducible through
  `scripts/live-e2e/test/installed-two-repository-proof.mjs`: it invokes the
  packaged `@grinrus/aor@0.1.0-alpha.21` binary only as external subprocesses,
  retains a digest-addressed command journal under the selected evidence root,
  and passes provision, deterministic lock conflict/serialization, retry,
  integration, review approval, patch-only delivery, learning handoff, and lock
  cleanup while both source Git checkouts remain unchanged. A second installed
  qualification runner now proves Prepare-to-Start-to-Work and review/recovery
  completion through 19 public CLI commands with a deterministic local provider.
- Browser checks used the running app without API route fulfilment: desktop
  keyboard focus, 390x844 mobile overflow, 200% zoom overflow, reduced-motion
  emulation, zero console errors, and zero POSTs during read/reload checks.
- The immutable record is
  `docs/research/27-w71-s14-installed-control-plane-evidence.json`.
- The installed closure report is retained by the runner under its
  `runtime_evidence_ref` and records ten successful public CLI commands plus
  the blocked overlapping-lock attempt. The installed control-plane
  qualification report is `/tmp/aor-installed-control-plane-qualification-s14-final5.json`
  (`sha256:b9f50e84ae9d3f76cc488f1135eeaf453845e05fff2a50c917ee7f4a76e525b9`)
  with 19 public commands and both required scenarios passing.
- The runtime/control-plane candidate commit represented by the freeze is
  `7850998d8931498cc970c88f36533ef7db575e67`; its fresh 16-case adversarial
  proof is
  `sha256:f4b5206fb6217e57f11f28b5dc6cd5918018d4080faef1bd8dc41171c115fbec`,
  and its same-commit qualification manifest is
  `sha256:3a4fca3c0845e934dea00123efe9ae411e9a9fcfb738d986c3add859d8e3d15`.
  The durable review decision and learning handoff passed. The historical
  run-health record still contains the earlier missing-review-decision failure
  and diagnostic warning; it was not rewritten or used as fresh provider proof.
- Package/browser checks previously passed on the merged UI baseline. The
  current diagnostic remains non-green because of retry timing and missing
  local Playwright browser executables; no provider rerun is claimed.

## Exit condition

S14 may be marked done only after the merged installed proof and immutable
freeze manifest are present **and** the public two-repository
provision-to-integration-to-delivery journey is closed. The integrated-local
evidence now closes the public multirepo journey and W71-AUD-006/W71-AUD-007.
The slice is still release-blocked until the separately authorized W66-S09
provider matrix is available. Readiness must identify only that external hold
without stale UI or W71 source-of-truth claims.
