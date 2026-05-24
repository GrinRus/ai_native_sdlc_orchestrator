# Self-hosted incident runbook

Use this runbook when a bounded self-hosted alpha run produces an unexpected
failure, unsafe output, suspected secret exposure, or delivery concern.

## Immediate containment

1. Stop detached API and web surfaces.
2. Stop external runner processes owned by the run.
3. Preserve `.aor/` evidence before deleting or rewriting runtime state.
4. Preserve target repository status, current branch, and commit ids.
5. Do not push, publish, or enable upstream write-back while triage is open.

## Evidence to capture

- run id and project id;
- command or route invoked;
- delivery mode and write-back policy;
- `.aor/` reports, live-run events, run-control audit records, review reports,
  delivery manifests, and Runtime Harness reports;
- sanitized terminal excerpts when needed;
- affected target repository paths and changed-path summaries.

## Triage checklist

| Question | Expected alpha action |
|---|---|
| Did transport auth deny the request? | Inspect `auth.*` error payloads and confirm mutation handlers were not invoked. |
| Did policy block a risky action? | Preserve the run-control audit record and approval context. |
| Did output include a secret? | Treat the artifact as sensitive, rotate the upstream secret, and commit only sanitized evidence. |
| Did delivery touch unexpected paths? | Keep the target checkout unchanged until changed paths are reviewed; prefer patch-only evidence. |
| Is OpenCode involved? | Do not promote OpenCode story status without future real OpenCode live-baseline proof. |

## Recovery

1. Follow `docs/ops/self-hosted-backup-restore.md` for workspace-local restore.
2. Re-run `pnpm check` and `pnpm production:ready --json` before release review.
3. Open or update incident evidence through the existing incident/audit command
   surfaces when the runtime evidence is safe to inspect.
4. Backfill only sanitized incident learnings into docs, datasets, suites, or
   backlog slices.

## Escalation boundary

This runbook does not cover hosted SaaS incidents, tenant billing, enterprise
identity, managed rollback, or provider-side credential compromise beyond
rotating external secrets with the owning provider.
