# ADR 0002: Alpha control plane remains hybrid module plus HTTP/SSE

## Status

Accepted for W30 alpha hardening.

## Context

The current API surface is exported as module operations and is also available
through a detached HTTP/SSE transport. The target stack names a NestJS-backed
detached control-plane transport, but the current alpha uses the existing
Node.js ESM implementation.

## Decision

For the current alpha distribution, the control-plane API remains a hybrid
module plus detached HTTP/SSE transport. The implemented detached route surface
is documented by `docs/contracts/control-plane-api.openapi.json` and validated
against router metadata by `pnpm production:ready`.

## Consequences

- API route drift is guarded without introducing a framework migration.
- The CLI/API lifecycle boundary remains owned by shared orchestrator-core
  services rather than app-to-app imports.
- `local-trusted` and `production-hardened` security modes remain the supported
  alpha transport modes.
- Full CLI-over-HTTP parity, hosted tenant APIs, and future framework-specific
  dependency injection are outside this decision.

## Migration triggers

Open a new ADR before adopting NestJS or another detached API framework. That
ADR must define compatibility for existing routes, OpenAPI drift checks,
auth/error semantics, SSE behavior, and migration testing.
