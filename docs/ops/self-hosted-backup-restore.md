# Self-hosted backup and restore

AOR alpha runtime evidence is workspace-local. The current alpha does not use a
database, managed object store, hosted backup service, or tenant rollback
system.

## What to preserve

Preserve the project runtime root before cleanup, rollback, or incident triage:

- `.aor/projects/<project-id>/reports/**`
- `.aor/projects/<project-id>/sessions/**`
- `.aor/projects/<project-id>/state/**`
- delivery manifests, review reports, run-control records, live-run events, and
  Runtime Harness evidence under the runtime root

Treat runtime artifacts as sensitive until they are reviewed and sanitized.

## Backup procedure

1. Stop detached API and web surfaces.
2. Record the target repository commit and current delivery mode.
3. Copy the `.aor/` runtime root to an operator-controlled backup location.
4. Restrict access to the backup because it may contain prompts, paths,
   operator intent, or provider output.
5. Run `pnpm check` and `pnpm production:ready --json` from the source checkout
   after preserving evidence if release review continues.

## Restore procedure

1. Restore the target repository to the expected commit or branch state.
2. Restore `.aor/` into the same workspace-relative runtime root.
3. Re-run `aor doctor --project-ref <repo> --json`.
4. Re-run the relevant read-only inspection commands before any mutation:
   `aor next --json`, `aor run status --json`, or API read routes.
5. Do not resume code-changing work until delivery policy, approvals, and
   runtime evidence match the intended run.

## Non-goals

- PostgreSQL backup/restore.
- S3-compatible evidence recovery.
- Hosted tenant migration rollback.
- Enterprise identity rollback.
- Recovering unsanitized committed secrets.
