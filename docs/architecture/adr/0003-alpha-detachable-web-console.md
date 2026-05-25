# ADR 0003: Web console remains optional and detachable

## Status

Accepted for W30 alpha hardening. Amended by ADR 0004 for W31 packaged local
SPA launch.

## Context

AOR is headless-first. The CLI is the primary public operator path today, the
API is the supported control-plane transport for the bounded self-hosted mode,
and the web surface mirrors operator state without owning orchestration.

## Decision

For the current alpha distribution, the web console remains optional and
detachable. CLI/API/headless operation must remain valid without the web app.
Release smoke coverage may verify web/API guidance, but it must not require a
hosted service or make the web console the runtime owner.

ADR 0004 amends this boundary: the npm alpha may include a packaged local SPA
and `aor app` may launch it as a supported installed-user surface, as long as
headless CLI/API/runtime operation remains valid without that SPA.

## Consequences

- Web actions must continue to call control-plane mutations or read models.
- Self-hosted release docs describe the web console as optional.
- Installed-package smoke tests can verify `aor app --smoke --open false --json`
  without starting a hosted UI or requiring the web console for runtime
  operation.
- Next.js/React target work remains a future architecture track.

## Migration triggers

Open a new ADR before making the web console required for runtime operation or
before moving the web surface to Next.js/React as an active distribution
dependency. That ADR must preserve headless operation or explicitly replace the
current release boundary.
