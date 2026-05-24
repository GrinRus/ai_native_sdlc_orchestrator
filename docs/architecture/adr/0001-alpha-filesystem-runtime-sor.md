# ADR 0001: `.aor/` remains the alpha runtime system of record

## Status

Accepted for W30 alpha hardening.

## Context

The current implementation baseline uses a Node.js ESM workspace with `.aor/`
as the runtime root for materialized reports, packets, manifests, and evidence.
The target architecture names PostgreSQL for run/query state and
S3-compatible evidence storage, but those are roadmap intent rather than active
runtime dependencies.

## Decision

For the current alpha distribution, `.aor/` remains the runtime system of
record. Self-hosted operators preserve, back up, restore, and inspect local
workspace evidence under `.aor/`. Production-readiness checks must not imply a
database-backed or hosted durability model.

## Consequences

- Backup and incident runbooks are workspace-local.
- Release evidence must stay sanitized before it is committed.
- `.aor/` remains ignored runtime state and must not be committed.
- Query projections and API read models continue to derive from local durable
  runtime artifacts.

## Migration triggers

Open a new ADR before moving runtime system-of-record ownership to PostgreSQL,
S3-compatible storage, or a durable workflow backend. That ADR must define
schema ownership, migration, backup/restore, retention, and compatibility
rules.
