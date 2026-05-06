# Installed-user first run

## Purpose
This runbook covers the W21-S02 public first-run shortcuts. The shortcuts are wrappers over existing runtime-owned command families, not replacements for grouped CLI commands.

## Commands
```sh
aor --help
aor doctor --project-ref <repo>
aor onboard <repo> --project-profile <profile>
aor next --project-ref <repo>
aor app --project-ref <repo>
```

Guided shortcuts default to human-readable output. Pass `--json` when automation needs stable fields such as `guided_status`, `guided_actionable_blockers`, `resolved_project_ref`, and `resolved_runtime_root`.

## Wrapper ownership
| Guided command | Low-level ownership | Notes |
| --- | --- | --- |
| `aor doctor` | environment and project readiness probe | Read-only. Reports actionable blockers without mutating `.aor/`. |
| `aor onboard <repo>` | `aor project init --project-ref <repo>` | Initializes the runtime-root layout through the existing bootstrap path when a profile is discoverable or supplied. |
| `aor next` | current first-run state | Points to onboarding or intake/status commands. W21-S04 owns durable deterministic next-action reports. |
| `aor app` | `aor ui attach` / `aor ui detach` | Web is optional; headless CLI/API operation remains valid. |

## Smoke transcript shape
The CLI test fixture `apps/cli/test/fixtures/installed-user-first-run-transcript.json` records the expected first-run command sequence:
1. `doctor` reports ready status and no blockers on a valid temp repository.
2. `onboard` dispatches through `project init` with an explicit profile and writes runtime state under `.aor/`.
3. `app` reports an optional, non-mandatory web surface.
4. `next` points to a safe low-level follow-up after onboarding.

No upstream writes are part of this first-run shortcut layer.
