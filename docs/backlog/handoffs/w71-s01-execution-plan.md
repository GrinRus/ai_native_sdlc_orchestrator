# W71-S01 execution handoff

## Coordination disposition

Recorded on 2026-09-05 against `main` at `f6de7e31`: `no-overlap`.

The sibling task `Улучшить UI и UX` remains active on
`codex/command-desk-ui` with immutable handoff commit `654eb576`, but it owns
the Command Desk UI paths only. W71-S01 changes readiness, story/backlog
source-of-truth, and repository-integrity tooling; it does not edit
`apps/web/src/**`, `apps/web/browser/**`, `apps/web/test/**`,
`apps/web/dist/**`, or the UI product refinement document. The UI handoff is
therefore recorded for awareness and does not require `merge-first`.

## Detailed implementation plan

1. Preserve the historical AUD-001…055 ledger and create a separate
   machine-readable post-W70 disposition with stable W71 finding IDs, owners,
   severity, affected invariants, release impact, evidence references, and
   explicit evidence-tier policy.
2. Make `production:ready` validate the W71 disposition, expose each open
   blocker in `blocking_invariants`, and keep `release_clearance=false` while
   W71 findings remain open. Keep W66 qualification history separate.
3. Update the story matrix so W62 fixture-only multirepo claims are `partial`
   with W71 owner slices, while preserving the already downgraded Task and
   Ask AOR rows and machine-checked status counts.
4. Add a small pre-remediation gate and manifest. It discovers committed,
   staged, working-tree, and untracked changes; classifies every changed
   source/test file; executes focused lint/typecheck/test commands; and fails
   on unmapped files, spawn errors, signals, timeouts, or silent non-zero exits.
5. Add deterministic failure fixtures/tests and document the command as a
   prerequisite for W71-S02. Leave dependency policy, full Node-matrix
   stabilization, and broad historical coverage to W71-S03.

## Acceptance evidence

- `docs/research/26-w71-audit-disposition.json` validates as the current
  post-W70 release-blocking disposition.
- `production:ready` reports W71 blockers and preserves the audit hold.
- Story counts and W62 owner slices are internally consistent.
- `pnpm remediation:gate` reports exact changed-file/check coverage and
  fails closed under the seven command/file fixtures.
- `pnpm slice:status`, `pnpm slice:next`, `pnpm slice:plan -- W71-S02`, and
  the canonical slice gate are run before the slice is closed.
