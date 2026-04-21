# Technical stack

## Primary implementation language
**TypeScript** is the default language for AOR.

Why:
- one language across API, CLI, workers, and web;
- shared contracts and validators;
- faster MVP delivery;
- good fit for modern orchestration libraries and web tooling.

Python may be used for optional offline utilities or experimental evaluators, but the core runtime should not depend on Python in MVP.

## Runtime stack
- **Node.js** for core runtime
- **NestJS** for the control-plane API
- **Temporal** for durable workflows, pause/resume, approvals, retries, and long-running jobs
- **Next.js + React** for the detachable web console
- **pnpm workspaces** for the AOR monorepo itself

## Storage and infrastructure
- **PostgreSQL** for project, run, approval, promotion, and query state
- **S3-compatible object storage** for evidence, logs, diffs, reports, and snapshots
- **Redis** as optional cache or short-lived pub/sub layer, never as source of truth
- **OpenTelemetry** for traces, metrics, and logs
- **SSE-first live events** for the UI and operator surfaces

## Execution environment
- clean workspaces or worktrees;
- explicit repo scopes and command allowlists;
- `.aor/` as the default runtime root;
- containerized replay when stronger reproducibility is needed.
