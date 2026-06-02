# Self-hosted environment matrix

Use this matrix to choose the bounded alpha operating mode before starting a
local AOR run.

## Modes

| Mode | Primary surface | Required credentials | Required commands | Evidence and safety boundary |
|---|---|---|---|---|
| Local trusted | CLI plus module-backed API helpers | none for AOR transport; runner credentials only when the selected external runner requires them | `pnpm check`; `pnpm aor doctor --project-ref <repo> --json`; `pnpm aor onboard --project-ref <repo> --json` | Writes only local `.aor/` runtime evidence unless the operator chooses another delivery mode. Transport auth can be disabled for loopback development. |
| Production-hardened loopback | Detached HTTP/SSE API plus CLI | bearer principals configured outside committed files; explicit `read` and/or `mutate` permissions; optional runner credentials outside repo files | `pnpm production:ready --json`; start detached API with `production-hardened` security mode; verify denied and allowed routes | Requires bearer auth for read, stream, and mutation routes. Transport denials do not invoke mutation handlers. |
| Connected web | Optional flow-centric web console launched locally or attached to a control-plane API | same bearer principals as the detached API when the API is production-hardened | `aor app`; `aor app --smoke --open false --json`; `aor ui attach --project-ref <repo> --control-plane <url>` | Web is detachable and must call control-plane read/mutation surfaces. The app smoke must prove SPA/config/project-index/state plus first-run wizard, project switcher, flow selector, and `New Flow` bundle markers. CLI/API/headless operation remains valid without web. |
| npm alpha install | Installed `@grinrus/aor` CLI plus packaged local SPA | npm registry access; runner credentials only for explicit live external-runner workflows | `npm install -g @grinrus/aor@0.1.0-alpha.5`; `aor --help`; `cd <repo> && aor app`; advanced: `aor doctor --project-ref <repo> --json`; `aor onboard --project-ref <repo> --json` | Public alpha package smoke path proves help, doctor/onboard compatibility, packaged flow-centric local app smoke, no-settings UI onboarding, and no surprise writes outside `.aor/`. It does not prove hosted SaaS, Docker/GHCR, SSO, or unattended production automation. |

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
pnpm aor doctor --project-ref <repo> --json
pnpm aor onboard --project-ref <repo> --json
pnpm aor app --help
pnpm aor app --project-ref <repo> --smoke --open false --json
```

Use `no-write` for inspection and rehearsal. Use `patch-only` only when a
code-changing delivery proof is explicitly intended and reviewable local patch
artifacts are acceptable.
