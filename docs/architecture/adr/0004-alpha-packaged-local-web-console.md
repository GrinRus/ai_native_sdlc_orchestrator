# ADR 0004: Packaged local web console for installed users

## Status

Accepted for W31 installed-user local app launch.

## Context

ADR 0003 keeps AOR headless-first and makes the web console optional and
detachable. That remains the runtime boundary, but the npm alpha first-run path
was still hard to understand because installed users had to read internal CLI,
API, and web docs before seeing a guided Mission intake surface.

The package already exposes the CLI and shared runtime modules. W31 adds a
small React/Vite SPA that can be built into static assets and served from the
same loopback process as the control-plane API.

## Decision

The npm alpha package includes `apps/web/dist` as a supported installed-user
surface. `aor app` starts a foreground local loopback server, serves the
packaged SPA at `/`, serves `/app-config.json`, exposes the existing
same-origin `/api/projects/:projectId/**` control-plane routes, opens the
browser by default, and stops when the foreground process exits.

The SPA may guide the first Mission intake flow by calling
`POST /api/projects/:projectId/lifecycle-command/actions` with
`command: "mission create"` and then `command: "next"`. It must not define
new packet fields, own orchestration decisions, or bypass headless CLI/API
policy gates.

## Consequences

- Headless CLI/API/runtime operation remains valid when `apps/web/dist` is not
  running.
- `apps/api` remains a thin export surface; the CLI launcher uses shared
  control-plane HTTP transport under `packages/orchestrator-core`.
- Release packaging must include `apps/web/dist` and the shared launcher/runtime
  files.
- Release smoke can run `aor app --smoke --open false --json` against a
  temporary project and assert that only `.aor/` changes.
- The UI safe walkthrough template only fills existing Mission intake fields
  and defaults delivery mode to `no-write`.

## Migration triggers

Open a new ADR before making the web console mandatory, moving the installed
surface to a hosted service, replacing the shared HTTP transport with a
framework-owned server, or adding UI-only packet schema fields.
