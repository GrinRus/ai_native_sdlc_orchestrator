# Self-hosted environment matrix

Use this matrix to choose the bounded alpha operating mode before starting a
local AOR run.

## Modes

| Mode | Primary surface | Required credentials | Required commands | Evidence and safety boundary |
|---|---|---|---|---|
| Local trusted | CLI plus module-backed API helpers | none for AOR transport; runner credentials only when the selected external runner requires them | `pnpm check`; `pnpm aor doctor --project-ref <repo> --json`; `pnpm aor onboard --project-ref <repo> --json` | Writes only local `.aor/` runtime evidence unless the operator chooses another delivery mode. Transport auth can be disabled for loopback development. |
| Production-hardened loopback | Detached HTTP/SSE API plus CLI | bearer principals configured outside committed files; explicit `read` and/or `mutate` permissions; optional runner credentials outside repo files | `pnpm production:ready --json`; start detached API with `production-hardened` security mode; verify denied and allowed routes | Requires bearer auth for read, stream, and mutation routes. Transport denials do not invoke mutation handlers. |
| Packaged local web | Optional flow-centric SPA served by `aor app` on literal `127.0.0.1` or `::1` from the same origin as its control plane | none for the local transport; runner credentials only for explicit live external-runner workflows | `aor app`; `aor app --smoke --open false --json` | This is the only supported browser topology. Canonical Host, exact browser Origin, JSON media type, 1 MiB, and five-second body bounds are enforced. Same-OS-account local clients are trusted; LAN, hostile-local, multi-user, and arbitrary remote attachment require a separate authenticated topology. |
| npm alpha install | Installed `@grinrus/aor` CLI plus packaged local SPA | npm registry access; runner credentials only for explicit live external-runner workflows | resolve `AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"`; `npm install -g "@grinrus/aor@$AOR_VERSION"`; `aor --help`; registry proof: `npm exec --package "@grinrus/aor@$AOR_VERSION" -- aor ...` from a neutral temp runner directory | Public alpha package smoke proves the bounded local package surface only. It does not prove hosted SaaS, Docker/GHCR, SSO, arbitrary remote web, or unattended production automation. |

## Environment variables

| Variable | Mode | Purpose | Commit policy |
|---|---|---|---|
| `AOR_REDACTION_SECRETS` | all local CLI/API modes | Comma-separated local values to redact from CLI JSON output and transport surfaces. | never commit values |
| bearer token configuration | production-hardened API/web | Maps token values to non-secret token ids, permissions, and project scopes. | configure outside committed files |
| runner-specific credentials | live external-runner workflows | Lets external runner binaries authenticate with their own provider. | configure outside AOR project files |
| `AOR_BOOTSTRAP_ASSETS_ROOT` / `AOR_EXAMPLES_ROOT` | maintainer fixtures only | Overrides bundled assets for internal tests and proof fixtures. | do not use as public operator defaults |

## Verification commands

```bash
pnpm check
pnpm production:ready --json
pnpm w61:proof
pnpm w62:proof
pnpm aor doctor --project-ref <repo> --json
pnpm aor onboard --project-ref <repo> --json
pnpm aor app --help
pnpm aor app --project-ref <repo> --smoke --open false --json
```

For registry-package verification, create separate temporary `target` and
`runner` directories, `cd` into the runner, and use
`AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"` and then
`npm exec --yes --package "@grinrus/aor@$AOR_VERSION" -- aor ...`. Running that
smoke from the AOR source checkout can shadow the registry package with the
local package context and produce a false bin-resolution failure.

Use `no-write` for inspection and rehearsal. Use `patch-only` only when a
code-changing delivery proof is explicitly intended and reviewable local patch
artifacts are acceptable.

`pnpm w62:proof` writes only ignored proof output under
`node_modules/.cache/aor`. It verifies the two curated repo-aware execution
models, stable task/unit/attempt identity, bounded recovery, and coordinated
delivery projections. Run `pnpm test:web:browser` separately for the installed
loopback UI evidence referenced by the closure report.

Outside the bounded cleared matrix, external credentialed write-capable execution and
credentialed network delivery are blocked by default. Maintainer-only source
experiments must add `--unsafe-development-override true`; the resulting step or
delivery evidence must retain the override. This flag is not a supported
installed-user release mode.
