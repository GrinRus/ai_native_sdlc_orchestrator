# Installed-user first run

## Purpose
This runbook covers the public installed-user first run from npm install through the local UI. The shortcuts are wrappers over existing runtime-owned command families, not replacements for grouped CLI commands.

## Commands
```sh
npm install -g @grinrus/aor@0.1.0-alpha.8
aor --help
cd <repo>
aor app
```

`aor app` starts a foreground local loopback server, opens the browser by
default, and prints the URL. Press `Ctrl+C` in that terminal to stop it.
`aor doctor` and `aor onboard` remain the advanced/headless path for scripts,
but the primary installed-user path is the local UI wizard.

The UI first-run path is:
1. confirm Project Context: cwd candidate, editable project path, and runtime root preview;
2. use Runtime Readiness to explicitly run Initialize project when needed;
3. use First Flow to apply the safe walkthrough template;
4. submit Mission with `delivery-mode=no-write`;
5. use Next Action to refresh the deterministic next action and land in the active flow cockpit;
6. inspect the top-bar project switcher, flow selector, and selected active flow for blockers, evidence refs,
   runtime root, and no-write safety;
7. use `New Flow` only when starting fresh mission/intake evidence or a
   follow-up from learning closure;
8. use Add local project only for explicit local paths; the UI must not scan the filesystem or mix runtime/evidence between projects;
9. optionally use Ask AOR on any selected flow stage to create a bounded
   operator request against selected evidence or document refs.

Guided shortcuts default to human-readable output. Pass `--json` when automation needs stable fields such as `guided_status`, `guided_actionable_blockers`, `resolved_project_ref`, and `resolved_runtime_root`.

## First-run state matrix
| State | Primary UI surface | Expected action | Runtime/evidence boundary |
| --- | --- | --- | --- |
| Clean local project | First-run wizard, Project Context, Runtime Readiness | Confirm the project path and click **Initialize Project Runtime** only when ready. | Page load and smoke must not create `.aor/`; initialization writes only the selected runtime root. |
| Initialized without flows | First-run wizard, First Flow step | Create the first Mission from the safe walkthrough template. | Mission intake defaults to `delivery-mode=no-write`; target source files remain unchanged. |
| Active flow | Flow selector, active cockpit, stage workbench | Follow the next action, inspect blockers/evidence, or use Ask AOR for bounded no-write analysis. | Evidence, operator requests, and runtime trace stay scoped to the selected flow. |
| Completed flow | Completed flow view, learning closure, `New Flow` | Inspect read-only evidence or start a follow-up/new flow explicitly. | Completed-flow context is not reused as editable active state. |
| Multiple local projects | Top-bar project switcher and Add local project drawer | Add only explicit local paths and switch by project label/id. | Runtime roots, selected flow, operator requests, evidence refs, and blockers are isolated per project. |

Primary errors should name the failed project path, runtime root, profile, or
smoke route in user-facing language. Raw stack traces and raw refs are debug
details, not the primary installed-user explanation.

## Registry package smoke
Use this command path after publication when you need to prove the npm registry
package instead of the current source checkout:

```sh
TMP="$(mktemp -d)"
mkdir -p "$TMP/target" "$TMP/runner"
git -C "$TMP/target" init
cd "$TMP/runner"

npm exec --yes --package @grinrus/aor@0.1.0-alpha.8 -- aor --help

npm exec --yes --package @grinrus/aor@0.1.0-alpha.8 -- \
  aor app --project-ref "$TMP/target" --runtime-root "$TMP/target/.aor" --smoke --open false --json
```

The separate `$TMP/runner` directory is intentional. Do not run this
`npm exec --package` smoke from the AOR source checkout, because npm may use the
local `@grinrus/aor` package context and fail to put the registry package bin in
PATH. A false `aor: command not found` from the source checkout is a smoke
setup error, not proof that the published package is missing its `bin` entry.

For a clean target, the app smoke should pass without creating `$TMP/target/.aor`;
runtime state is created only after the user explicitly initializes the project
or after headless `aor onboard`.

## Wrapper ownership
| Guided command | Low-level ownership | Notes |
| --- | --- | --- |
| `aor doctor` | environment and project readiness probe | Read-only. Reports actionable blockers without mutating `.aor/`. |
| `aor onboard <repo>` | `aor project init --project-ref <repo>` | Initializes the runtime-root layout, emits an onboarding report, and defaults clean repos to bundled asset mode without copying `examples/`. |
| `aor mission create` | `aor intake create` | Writes product-intake packet evidence with goals, constraints, KPI, Definition of Done, allowed paths, source refs, and delivery mode. |
| `aor next` | current first-run state | Writes a durable deterministic next-action report with one primary action, blockers, evidence refs, and write-back policy. |
| `aor app` | shared control-plane HTTP transport plus packaged SPA | Launches the local UI; web is optional and headless CLI/API operation remains valid. |
| `aor request create/run/status` | `operator-request` runtime service and routed execution | Creates and runs bounded operator-initiated work through compiled context; read outputs are sanitized and no-write is default. |

## Mission safe template
The UI safe walkthrough template fills only existing `mission create` inputs:
- title;
- brief;
- goal;
- constraint;
- KPI;
- Definition of Done;
- `delivery-mode=no-write`.

Submitting the form posts `command: "mission create"` to the lifecycle-command
API and then posts `command: "next"` so the next-action report is refreshed.
The template does not change packet schemas or enable write-back.

Headless equivalent:
```sh
aor mission create \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --title "Small safe trial" \
  --brief "Inspect the project and recommend the next no-write step" \
  --goal "Produce bounded next-action evidence" \
  --constraint "No upstream writes, no target file edits, and no external runner execution" \
  --kpi "trial-ready:Trial readiness:ready:status" \
  --dod "No upstream writes are attempted" \
  --delivery-mode no-write \
  --json

aor next --project-ref <repo> --runtime-root <repo>/.aor --json
```

## Ask AOR / operator request
Use Ask AOR when the operator wants AOR to analyze, explain, revise, repair,
validate, plan, implement, or review a bounded artifact without starting a
free-form chat. In the UI, open a stage, select **Ask AOR**, attach evidence or
document refs from the Evidence & Documents workbench, keep delivery mode
`no-write` unless a patch proposal is explicitly needed, and run the request.
The UI sends the selected flow as `target_flow_id`; completed flows allow only
read-only inspection requests.

Headless equivalent:
```sh
aor request create \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --stage discovery \
  --target-flow-id <flow_id> \
  --intent analyze \
  --request "Explain the current blocker and suggest the next safe action." \
  --target-ref evidence://.aor/projects/<project_id>/reports/next-action-report.json \
  --json

aor request run \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --request-ref <operator_request_ref> \
  --target-step plan \
  --json
```

Patch proposals require explicit scope:
```sh
aor request create \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --stage review \
  --target-flow-id <flow_id> \
  --intent revise-document \
  --request "Propose edits that make the onboarding runbook clearer." \
  --target-ref docs/ops/installed-user-first-run.md \
  --allowed-path "docs/ops/**" \
  --delivery-mode patch-only \
  --json
```

Expected request evidence:
- the request artifact under `.aor/projects/<project_id>/reports/`;
- sanitized CLI/API/web summaries that omit raw request text;
- a routed step result with `operator_request_ref`;
- `target_flow_id` linking the request to the selected active flow;
- proposal refs for no-write and patch-only modes;
- patch refs for patch-only mode;
- a refreshed `next-action-report`.

## Smoke mode
Use smoke mode for release or CI validation:
```sh
aor app \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --smoke \
  --open false \
  --json
```

Expected JSON:
- `status: "smoke-pass"`;
- `html_loaded: true`;
- `first_run_wizard_loaded: true`;
- `project_switcher_loaded: true`;
- `flow_selector_loaded: true`;
- `new_flow_action_loaded: true`;
- `config_project_id` matches `project_id`;
- `state_project_id` matches `project_id`;
- `config_default_project_id` matches `project_index_default_project_id`.

## Smoke transcript shape
The CLI test fixture `apps/cli/test/fixtures/installed-user-first-run-transcript.json` records the expected first-run command sequence:
1. `doctor` reports ready status and no blockers on a valid temp repository for the advanced/headless path.
2. `onboard` dispatches through `project init`, writes runtime state plus `onboarding-report.json` under `.aor/`, and does not copy example registries unless materialization is explicit.
3. `app` reports an optional, non-mandatory local web surface and the installed-package smoke path verifies the packaged SPA/config/API routes plus first-run wizard, project switcher, flow selector, and `New Flow` bundle markers.
4. `next` points to a safe low-level follow-up after onboarding.

No upstream writes are part of this first-run shortcut layer.

## Guided journey proof
The `installed-user-guided-journey.yaml` proof profile rehearses the installed-user sequence on a clean catalog target; W34-S06 hardens that profile with browser-task and flow-loop evidence:
```sh
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/installed-user-guided-journey.yaml
```

The proof starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; captures `aor mission create`; then follows execution, review decision, delivery, release, and learning closure through public CLI subprocesses. After learning closure it creates a follow-up mission with `--follow-up-source-handoff-ref`, refreshes `next` for the second flow, and creates a flow-targeted `request create --target-flow-id` record. It also runs `aor app --smoke true --open false --json` as a release/render guardrail that must include the flow selector and `New Flow` markers, but final acceptance still requires browser-task/frontend evidence refs and accepted skill-agent verdicts.

The generated `guided_journey` summary is passable only when CLI transcripts, flow-loop fields, browser-task/frontend evidence refs, durable packets/reports, unchanged target `HEAD`, `.aor/` runtime ownership, and `write_back_to_remote=false` assertions are all present.
