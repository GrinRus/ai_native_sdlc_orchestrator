# ADR index

This directory records accepted architecture decisions for the current AOR
alpha boundary. ADRs here describe the implemented self-hosted CLI/API alpha
commitments and the migration triggers for target architecture work. They do
not by themselves claim that the target stack is active.

## Accepted decisions

| ADR | Status | Decision | Applies to |
|---|---|---|---|
| `0001-alpha-filesystem-runtime-sor.md` | Accepted | `.aor/` remains the alpha runtime system of record. | Runtime state, evidence, backup/restore, release proof |
| `0002-alpha-hybrid-api-transport.md` | Accepted | The alpha control plane remains hybrid module plus detached HTTP/SSE transport. | CLI/API boundary, OpenAPI contract, production-hardening gate |
| `0003-alpha-detachable-web-console.md` | Accepted | The web console remains optional and detachable; CLI/API stay primary. | Operator UX, self-hosted release mode, web smoke boundary |

## Target-architecture relationship

The target architecture in `docs/architecture/03-technical-stack.md` still
names TypeScript-first runtime layers, NestJS, Next.js/React, durable
orchestration, PostgreSQL, S3-compatible evidence storage, Redis, and
OpenTelemetry as roadmap intent. W30 does not implement those dependencies.

Future migration work should add new ADRs before changing the runtime system of
record, transport framework, web ownership boundary, or durable orchestration
model.
