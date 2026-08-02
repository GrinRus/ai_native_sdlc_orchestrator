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

AOR has three distinct deployment topologies:

1. **Packaged local application:** `aor app` binds to loopback and serves the
   SPA and control plane from one same-origin process. This is the only
   supported browser topology in the alpha channel. The browser stores no AOR
   bearer credential.
2. **Detached hardened headless API:** the HTTP/SSE control plane can run without
   the SPA in `production-hardened` mode with out-of-band bearer principals.
   Headless CLI and module workflows remain usable independently.
3. **Future hosted or remote web product:** arbitrary remote SPA attachment,
   browser credential storage, SSO/OAuth/OIDC, TLS termination, reverse-proxy
   trust, tenant isolation, public CORS, WAF, and internet-facing rate limiting
   are not supported by this ADR.

The npm alpha package includes `apps/web/dist` as a supported installed-user
surface. `aor app` starts a foreground local loopback server, serves the
packaged SPA at `/`, serves `/app-config.json`, exposes the existing
same-origin `/api/projects/:projectId/**` control-plane routes, exposes
`GET /api/projects` for the explicit local project registry, opens the browser
by default, and stops when the foreground process exits.

The local-trusted listener binds only to literal `127.0.0.1` or `::1`, derives
one canonical listener authority after bind, and validates `Host` before static,
config, or API routing. Browser mutations require the exact listener `Origin`;
foreign/null origins and browser fetch metadata without Origin fail closed.
Mutation bodies are JSON-only, capped at 1 MiB, and bounded to five seconds.
`/app-config.json` is redacted, no-store, and omits absolute project paths.

The trust boundary includes processes running as the same OS account: a trusted
local CLI/curl request may omit Origin when it also omits browser fetch metadata.
LAN clients, hostile local accounts, multi-user hosts, hosted deployments, and
remote browsers are not covered. Supporting any of those modes requires a new
ADR with an authentication boundary; loopback address checks alone are not an
OS sandbox or tenant-isolation mechanism.

The SPA may guide first-run onboarding by previewing project context without
initializing `.aor/`, calling the existing runtime initialization command only
after explicit user action, and then guiding the first Mission intake flow by
calling
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
  temporary project, prove the first-run wizard, project switcher, flow
  selector, and `New Flow` bundle markers, and assert that only `.aor/`
  changes.
- The UI safe walkthrough template only fills existing Mission intake fields
  and defaults delivery mode to `no-write`.

## Migration triggers

Open a new ADR before making the web console mandatory, moving the installed
surface to a hosted service, permitting an arbitrary remote control-plane
attachment, storing bearer tokens in a browser, adding SSO/OAuth/OIDC, TLS
termination, reverse-proxy trust, tenant isolation, public CORS, a WAF, or
internet-facing rate limiting, replacing the shared HTTP transport with a
framework-owned server, supporting hostile-local or multi-user operation, or
adding UI-only packet schema fields.
