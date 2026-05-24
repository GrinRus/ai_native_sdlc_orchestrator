# Technical stack

## Current implementation baseline

The repository currently runs on a Node.js ESM JavaScript baseline:
- Node.js runtime with `.mjs` modules across `apps/**` and `packages/**`;
- pnpm workspace monorepo with repository-integrity gates and package/app tests;
- headless-first control-plane behavior exposed through CLI plus module-backed API and detachable web surface;
- `.aor/` runtime root for materialized reports, packets, manifests, and related evidence.

W30 accepted ADRs keep this alpha boundary explicit:
- `docs/architecture/adr/0001-alpha-filesystem-runtime-sor.md` keeps `.aor/` as the alpha runtime system of record.
- `docs/architecture/adr/0002-alpha-hybrid-api-transport.md` keeps the API as hybrid module plus detached HTTP/SSE transport.
- `docs/architecture/adr/0003-alpha-detachable-web-console.md` keeps the web console optional and detachable.

## Target architecture stack (roadmap intent)

The long-term design target remains:
- TypeScript-first runtime layers;
- NestJS-backed detached control-plane transport;
- Next.js + React detachable operator console;
- Temporal-style durable orchestration for long-running workflow controls.

These target components are design intent, not a claim that every runtime dependency is already active in the current repository.

## Storage and infrastructure (target-oriented)

Planned production-oriented infrastructure surfaces include:
- PostgreSQL for run/query state;
- S3-compatible evidence storage;
- Redis as optional cache/pub-sub helper (not source of truth);
- OpenTelemetry telemetry pipeline;
- SSE-first operator event delivery.

## Execution environment
- clean workspaces or worktrees;
- explicit repo scopes and command allowlists;
- `.aor/` as the default runtime root;
- containerized replay when stronger reproducibility is needed.
