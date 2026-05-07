# Installed-user first run

## Purpose
This runbook covers the W21-S02 public first-run shortcuts. The shortcuts are wrappers over existing runtime-owned command families, not replacements for grouped CLI commands.

## Commands
```sh
aor --help
aor doctor --project-ref <repo>
aor onboard <repo>
aor mission create --project-ref <repo> --goal <goal> --constraint <constraint> --kpi <id:name:target> --dod <definition>
aor next --project-ref <repo>
aor app --project-ref <repo>
```

Guided shortcuts default to human-readable output. Pass `--json` when automation needs stable fields such as `guided_status`, `guided_actionable_blockers`, `resolved_project_ref`, and `resolved_runtime_root`.

## Wrapper ownership
| Guided command | Low-level ownership | Notes |
| --- | --- | --- |
| `aor doctor` | environment and project readiness probe | Read-only. Reports actionable blockers without mutating `.aor/`. |
| `aor onboard <repo>` | `aor project init --project-ref <repo>` | Initializes the runtime-root layout, emits an onboarding report, and defaults clean repos to bundled asset mode without copying `examples/`. |
| `aor mission create` | `aor intake create` | Writes product-intake packet evidence with goals, constraints, KPI, Definition of Done, allowed paths, source refs, and delivery mode. |
| `aor next` | current first-run state | Writes a durable deterministic next-action report with one primary action, blockers, evidence refs, and write-back policy. |
| `aor app` | `aor ui attach` / `aor ui detach` | Web is optional; headless CLI/API operation remains valid. |

## Smoke transcript shape
The CLI test fixture `apps/cli/test/fixtures/installed-user-first-run-transcript.json` records the expected first-run command sequence:
1. `doctor` reports ready status and no blockers on a valid temp repository.
2. `onboard` dispatches through `project init`, writes runtime state plus `onboarding-report.json` under `.aor/`, and does not copy example registries unless materialization is explicit.
3. `app` reports an optional, non-mandatory web surface.
4. `next` points to a safe low-level follow-up after onboarding.

No upstream writes are part of this first-run shortcut layer.

## Guided journey proof
The W21-S07 proof profile rehearses the installed-user sequence on a clean catalog target:
```sh
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/installed-user-guided-journey.yaml
```

The proof starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; captures `aor mission create`; then follows execution, review decision, delivery, release, and learning closure through public CLI subprocesses. It also runs the optional web smoke script and records detached web evidence.

The generated `guided_journey` summary is passable only when CLI transcripts, web smoke output, durable packets/reports, unchanged target `HEAD`, `.aor/` runtime ownership, and `write_back_to_remote=false` assertions are all present.
