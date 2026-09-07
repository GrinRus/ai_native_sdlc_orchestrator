# W71-S03 execution plan — deterministic repository gate and dependency/process safety

## Coordination contract

- UI sibling task: `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`).
- Disposition: `no-overlap`.
- This slice owns repository scripts, dependency policy, lockfile, CI/release
  gate metadata, and test execution evidence. It does not edit `apps/web/**`,
  `apps/web/dist/**`, or the sibling checkout.
- The sibling's immutable handoff at `59943bfa` is evidence only; it is not a
  dependency for this slice. W71-S14 will re-check that handoff before its
  qualification freeze.

## Evidence-driven plan

1. Upgrade the vulnerable `fast-uri` lockfile path and add one bounded command
   for full and production high-severity audits. Keep exceptions explicit,
   owned, and expiry-checked.
2. Centralize local command supervision: classify spawn errors, non-zero exits,
   signals, timeouts, and interactive credential prompts; apply bounded
   timeouts to test, typecheck, lint, build, pack, smoke, and audit owners.
   The single CLI test module is executed in four disjoint name partitions so
   one expensive or leaked fixture cannot consume the whole test-group budget.
3. Make Node 22.x (`>=22 <23`) the only advertised runtime until an equivalent
   installed-CLI matrix is proven. Pin CI and dependency-audit jobs to the
   validated 22.14.0 baseline and make release verification enforce it.
4. Publish `gate-coverage.json` from the repository test manifest. It must list
   every source/test/browser file, the checks that own it, and any generated
   exclusion with owner, reason, and expiry.

## Acceptance and verification

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm audit:all` passes both full and production high-severity modes.
- Process fixtures cover missing binary, silent exit, signal, timeout, and
  prompt suppression.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `pnpm quality:ratchet`, and `pnpm release:verify` pass; the execution and
  coverage reports contain exact file accounting.
- The final `pnpm check` is repeated three times when the runner is available;
  any environment timeout is recorded as a residual risk rather than silently
  treated as success.

## Review note

Review must check that no UI files or sibling worktree state entered the diff,
that all child process failures remain fail-closed, and that the package,
README, CI, and release verifier advertise the same Node range.
