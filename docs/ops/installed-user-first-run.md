# Installed-user first run

## Purpose
This runbook covers the public installed-user first run from npm install through the local UI. The shortcuts are wrappers over existing runtime-owned command families, not replacements for grouped CLI commands.

## Commands
```sh
AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"
npm install -g "@grinrus/aor@$AOR_VERSION"
aor --help
cd <repo>
aor app
```

`aor app` starts a foreground local loopback server, opens the browser by
default, and prints the URL. Press `Ctrl+C` in that terminal to stop it.
The primary UI and headless path share `project connect`, `task prepare`, and
`task start`. Mutable state lives under `~/.aor`; use `AOR_HOME` only for tests
or an intentionally isolated run.

The UI first-run path is:
1. connect a local Git folder or an HTTPS/SSH Git URL;
2. enter intent text and/or attach supported text files;
3. run read-only **Prepare task**;
4. review or revise the normalized outcome, acceptance, scope, safety mode, and provider;
5. select **Confirm and start** to create the Flow and run its first executable action;
6. inspect the top-bar project switcher, flow selector, and selected active flow for blockers, logical evidence refs, and no-write safety;
7. use `New Flow` only when starting fresh mission/intake evidence or a
   follow-up from learning closure;
8. use Connect project for explicit local folders or Git URLs; the UI must not scan the filesystem or mix runtime/evidence between projects;
9. optionally use Ask AOR on any selected flow stage to create a bounded
   operator request against selected evidence or document refs.

Guided shortcuts default to human-readable output. Pass `--json` when automation needs stable fields such as `guided_status`, `guided_actionable_blockers`, `workspace_project_id`, and `resolved_project_ref`. AOR Home placement is server-owned and has no public runtime-root field.

## First-run state matrix
| State | Primary UI surface | Expected action | Runtime/evidence boundary |
| --- | --- | --- | --- |
| No connected project | Code source + intent | Choose a local Git folder or Git URL, then provide text and/or supported files. | Connection writes only to AOR Home; the target repository stays unchanged. |
| Connected without flows | Prepared task preview | Review normalization and choose **Confirm and start**. | Preparation is read-only; no partial Flow is created when normalization is blocked. |
| Active flow | Flow selector, active cockpit, stage workbench | Follow the next action, inspect blockers/evidence, or use Ask AOR for bounded no-write analysis. | Evidence, operator requests, and runtime trace stay scoped to the selected flow. |
| Completed flow | Completed flow view, learning closure, `New Flow` | Inspect read-only evidence or start a follow-up/new flow explicitly. | Completed-flow context is not reused as editable active state. |
| Multiple local projects | Top-bar project switcher and source chooser | Add only explicit local folders or Git URLs and switch by project label/id. | AOR Home data, selected flow, operator requests, evidence refs, and blockers are isolated by collision-safe workspace project ID. |

Primary errors should name the failed project source, workspace project, profile, or
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

AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"
npm exec --yes --package "@grinrus/aor@$AOR_VERSION" -- aor --help

npm exec --yes --package "@grinrus/aor@$AOR_VERSION" -- \
  aor app --project-ref "$TMP/target" --smoke --open false --json
```

The separate `$TMP/runner` directory is intentional. Do not run this
`npm exec --package` smoke from the AOR source checkout, because npm may use the
local `@grinrus/aor` package context and fail to put the registry package bin in
PATH. A false `aor: command not found` from the source checkout is a smoke
setup error, not proof that the published package is missing its `bin` entry.

For a clean target, the app smoke and source connection must leave
`$TMP/target/.aor` absent. Mutable connection, preparation, Flow, and evidence
state is written under AOR Home. A target-repository `.aor/` appears only after
the operator explicitly materializes portable configuration or exports selected
evidence.

## Quiet Cockpit installed acceptance

The W65-S07 gate packs the current package once, installs it into a disposable
prefix, and starts `aor app` from a neutral launcher with a disposable
`AOR_HOME`. Quiet Cockpit opens without a selector; the retired legacy input
normalizes to the single renderer with a migration notice. The blocking Chromium matrix covers
the twelve operator scenarios, seven responsive widths, keyboard focus,
reduced motion, and 200% zoom while blocking external browser requests. Raw
artifacts stay under ignored `.aor/quality/w63/s07/`; the reproducible summary
is `docs/research/15-w63-installed-console-acceptance.md`.

W63-S08 adds the versioned canonical safe no-write journey in
`apps/web/browser/fixtures/golden-lifecycle.json`. Its installed browser proof
drives all fifteen transitions through structured same-origin mutations,
checks durable readback after reload and stale-revision recovery, and requires
no terminal continuation. The exact proof boundary and W65 handoff are recorded
in `docs/research/16-w63-canonical-lifecycle-closure.md`, with post-cutover
readback indexed by `docs/research/23-w65-post-cutover-evidence-index.json`.

## W43 alpha.10 validation notes
W43-S02 re-validates the published `0.1.0-alpha.10` package from a neutral
temporary runner and browser-driven installed-user UI path. The slice produced
evidence only; no source fix or public contract change was required.

Findings and closure:

| Finding | Owner | Phase | Status | Evidence |
| --- | --- | --- | --- | --- |
| Registry package help and app smoke load from npm, not the source checkout. | environment | registry smoke | passed | `npm exec --package @grinrus/aor@0.1.0-alpha.10 -- aor --help`; `aor app --smoke --open false --json` reports `status: "smoke-pass"` with first-run wizard, project switcher, flow selector, and `New Flow` markers. |
| Clean smoke does not create runtime state before explicit initialization. | aor | onboarding | passed | The clean `target-a` app smoke returned matching `project_id`, `config_project_id`, `config_default_project_id`, `project_index_default_project_id`, and `state_project_id` values while `$TMP/target-a/.aor` remained absent. |
| Browser first run follows Project Context -> Runtime Readiness -> First Flow -> Next Action. | aor | first flow | passed | Clicking **Initialize Project Runtime** created the runtime state; **Start First Flow** used the safe no-write walkthrough template; **Resolve Next Action** landed in the active cockpit with `flow.target-a.first-aor-walkthrough-mpze0gde`, `aor discovery run`, blockers `0`, and five readable evidence artifacts. |
| Initialized-runtime resume preserves the active flow and next action. | aor | resume | passed | Reloading the UI kept the selected workspace project, Flow, no-write status, and discovery next action; storage remained server-owned. |
| Local multi-project state stays isolated across project switcher changes. | aor | project switching | passed | `POST /api/projects/actions` is the public action used by the Add local project drawer. A fresh minimal installed-package sequence confirmed add plus `GET /api/projects/target-b/state` kept `state_file: null` and did not create `$TMP/target-b/.aor`; the browser UI switcher then showed `target-b` without `target-a` flow/evidence and restored `target-a` flow/evidence after switching back. |
| Evidence refs render as operator-readable rows/cards with raw refs as debug actions. | aor | evidence rendering | passed | Active cockpit and Evidence & Documents showed artifact labels, stages, status, blockers, AOR Home status, and `Debug raw ref` actions instead of requiring physical path inspection. |
| Browser text-entry automation could not type into the Add local project drawer in this environment. | environment | browser evidence capture | documented | The in-app browser driver reported `Browser Use virtual clipboard is not installed` on `locator.fill`. The product path was still validated through the same public control-plane route used by the drawer, followed by browser project-switcher verification. |
| Source regression coverage for project route isolation remains green. | aor | regression | passed | `node --test apps/api/test/http-transport.test.mjs --test-name-pattern "local app project index and add-project action keep project runtimes isolated"` passed locally. |

## W41 alpha.8 validation notes
W41-S02 re-validates the published `0.1.0-alpha.8` package from a neutral
temporary runner before relying on local source-checkout behavior.

Findings and closure:

| Finding | Owner | Phase | Status | Evidence |
| --- | --- | --- | --- | --- |
| Registry package help and app smoke load from npm, not the source checkout. | environment | registry smoke | passed | `npm exec --package @grinrus/aor@0.1.0-alpha.8 -- aor --help`; `aor app --smoke --open false --json` reports `smoke-pass` with wizard, project switcher, flow selector, and `New Flow` markers. |
| Clean UI launch does not create runtime state before explicit initialization. | aor | onboarding | passed | Clean target has no `.aor/` before **Initialize Project Runtime**; initialization creates `project-init-state.json` only after the button click. |
| First-flow wizard creates a no-write mission and lands in the active cockpit. | aor | first flow | passed | Safe walkthrough template defaults to `No-Write (Safe)` and resolves the next action to `aor discovery run` after mission creation. |
| Local multi-project switching keeps runtime and flow state isolated. | aor | project switching | passed | Add-to-workspace leaves the second project uninitialized; initializing the selected project does not alter the first project's active flow. |
| Existing runtime sidecar refs rendered as `Evidence missing` in the selected-flow evidence list, graph, and trace. | aor | evidence rendering | fixed | Runtime state, onboarding report, and mission body sidecars now render as readable `ready` summaries; only genuinely unresolved refs are marked missing. |

## Wrapper ownership
| Guided command | Low-level ownership | Notes |
| --- | --- | --- |
| `aor doctor` | environment and project readiness probe | Read-only. Reports actionable blockers without mutating AOR Home or the connected repository. |
| `aor onboard <repo>` | compatibility wrapper over central project initialization | Initializes project state under AOR Home, emits an onboarding report, and leaves the connected repository unchanged. New automation should use `aor project connect` and `aor task prepare`. |
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
  --title "Small safe trial" \
  --brief "Inspect the project and recommend the next no-write step" \
  --goal "Produce bounded next-action evidence" \
  --constraint "No upstream writes, no target file edits, and no external runner execution" \
  --kpi "trial-ready:Trial readiness:ready:status" \
  --dod "No upstream writes are attempted" \
  --delivery-mode no-write \
  --json

aor next --project-ref <repo> --json
```

## Artifact readiness and prompt lineage

Use `aor next --json` as the public readiness read model after each
discovery/research/spec/planning transition. The stable automation fields are:

- `next_action_artifact_readiness.policy`
- `next_action_artifact_readiness.stages.mission`
- `next_action_artifact_readiness.stages.discovery`
- `next_action_artifact_readiness.stages.research`
- `next_action_artifact_readiness.stages.spec`
- `next_action_artifact_readiness.stages.planning`

Blocked or stale transitions must be explained by the stage record's
`reason`, `blocked_reasons[]`, `stale_reasons[]`, and
`required_evidence_refs[]`. Do not infer readiness from a missing UI button or
from raw runtime filenames when the next-action report is available.

For maintainer rehearsal proof, inspect the run summary's
`artifact_readiness_proof`. It is a compact index over public artifacts:

- `readiness_snapshots[]` points at the `aor next` reports captured after
  mission, discovery, spec, and planning.
- `prompt_lineage.steps[]` shows profile/default prompt refs, analysis prompt
  refs, and spec compiled-context refs.
- `discovery_research` summarizes the discovery research report status.
- `planning` points at the wave ticket and handoff packet.

Treat linked next-action reports, discovery research reports, spec
step-results, and handoff packets as the durable evidence. The summary only
keeps acceptance review short.

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
  --stage discovery \
  --target-flow-id <flow_id> \
  --intent analyze \
  --request "Explain the current blocker and suggest the next safe action." \
  --target-ref evidence://projects/<project_id>/reports/next-action-report.json \
  --json

aor request run \
  --project-ref <repo> \
  --request-ref <operator_request_ref> \
  --target-step plan \
  --json
```

Patch proposals require explicit scope:
```sh
aor request create \
  --project-ref <repo> \
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
2. Legacy `onboard` dispatches through `project init`, writes runtime state plus `onboarding-report.json` under AOR Home, and does not copy example registries unless materialization is explicit.
3. `app` reports an optional, non-mandatory local web surface and the installed-package smoke path verifies the packaged SPA/config/API routes plus first-run wizard, project switcher, flow selector, and `New Flow` bundle markers.
4. `next` points to a safe low-level follow-up after onboarding.

No upstream writes are part of this first-run shortcut layer.

## Guided journey proof
The internal installed-user guided journey profile rehearses the installed-user sequence on a clean catalog target; W34-S06 hardens that profile with browser-task and flow-loop evidence.

The proof starts from `aor doctor`, `aor onboard`, `aor app`, and `aor next`; captures `aor mission create`; then follows execution, review decision, delivery, release, and learning closure through public CLI subprocesses. After learning closure it creates a follow-up mission with `--follow-up-source-handoff-ref`, refreshes `next` for the second flow, and creates a flow-targeted `request create --target-flow-id` record. It also runs `aor app --smoke true --open false --json` as a release/render guardrail that must include the flow selector and `New Flow` markers, but outcome quality still requires browser-task AOR operator UI evidence refs and a post-run quality assessment when UI/UX quality is being claimed.

The generated `guided_journey` summary is passable only when CLI transcripts, flow-loop fields, browser-task AOR operator UI evidence refs, durable packets/reports, unchanged target `HEAD`, `.aor/` runtime ownership, and `write_back_to_remote=false` assertions are all present.
