# W71-S02 execution handoff

## Coordination disposition

Recorded on 2026-09-05 against `main` at `8402990d`: `no-overlap`.

The sibling task `Улучшить UI и UX` owns the Command Desk UI and is currently
on `codex/command-desk-ui` at local handoff commit `941f26da`. Its scope is
limited to `apps/web/src/**`, `apps/web/dist/**`, and the browser UI evidence.
W71-S02 will not edit those paths or the sibling worktree. The UI work is not a
dependency of path confinement, so `merge-first` is not required; the final
review will only re-check that the two change sets remain disjoint.

## Detailed implementation plan

1. Add a contract-level path-ownership document describing canonical roots,
   lexical and real-path checks, allowed path kinds, no-follow file reads,
   owner-marker binding, and durable cleanup states (`pending`, `deleting`,
   `deleted`, `delete-failed`). Include concrete examples for traversal,
   sibling-prefix escapes, nested and final symlinks, missing paths, and forged
   or corrupted ownership metadata; link it from the contracts index.
2. Extend the shared canonical-path primitive with a safe file reader and an
   owned-path removal helper. The reader validates every existing ancestor,
   rejects final symlinks for protected reads, opens with `O_NOFOLLOW` when
   available, and compares the opened file identity with `lstat` to close the
   read-side TOCTOU window. The removal helper rejects root/equal and escaped
   targets before any recursive delete.
3. Route repository Markdown ingress, current Markdown freshness checks,
   evidence export reads, registry fixture lookup, workspace cleanup, and
   workspace-set rollback/finalization through those helpers. Preserve
   relative in-bound dependency symlinks for copy operations, but never follow
   an escaping link or a forged owner marker.
4. Persist cleanup transitions atomically beside the managed owner marker and
   make retries/restarts idempotent. A failed or malformed marker records
   `delete-failed` and leaves the execution root and external sentinels intact;
   a successful delete records `deleted` before removing the owner marker.
5. Add adversarial tests for traversal, sibling-prefix and nested/final
   symlink escapes, file replacement during read, forged/corrupt markers,
   restart/retry cleanup, and workspace-set rollback. Add a tracked sink
   inventory/ratchet covering every recursive delete/copy sink and documenting
   why each sink is owned, routed, or intentionally out of scope.
6. Run focused tests, `pnpm test:references`, `pnpm remediation:gate`, and
   `pnpm slice:gate -- W71-S02`; review the final diff for UI-path overlap.
   Commit on `codex/w71-s02-path-containment`, push, open and merge the PR,
   fast-forward local `main` from `origin/main`, then advance to W71-S03.

## Acceptance evidence

- canonical path-ownership contract is indexed and reference-integrity clean;
- Markdown and evidence reads are canonical, no-follow, and identity-bound;
- workspace and workspace-set recursive deletes require canonical ownership;
- cleanup transitions survive restart and malformed ownership fails closed;
- adversarial tests preserve the primary checkout and external sentinels;
- the sink inventory ratchet fails on a newly unreviewed recursive sink;
- focused tests and the canonical slice gate pass.

## Verification note

The focused suites pass. The final `node scripts/test-runner.mjs` run reached
102/102 passing tests; its pre-existing CLI worker then hung after reporting
the complete suite and was interrupted. An earlier post-hardening
`project-verify` run also hit local `ENOSPC` while fixtures expanded, and
`pnpm remediation:gate` timed out at its 120-second test ceiling; these are
environment-capacity/runner failures rather than assertion failures.
`pnpm lint`, `pnpm typecheck`, `pnpm test:references`, `pnpm quality:ratchet`,
`pnpm build`, and `pnpm release:verify` pass on the final tree. Local
`pnpm slice:gate -- W71-S02` likewise reached 102/102 on prior retries but the
runner hung in the same CLI worker; the PR's remote CI is the final slice-gate
authority for this local runner limitation.
