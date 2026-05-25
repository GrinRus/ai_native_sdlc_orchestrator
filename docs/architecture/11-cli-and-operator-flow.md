# CLI and operator flow

## Role of the CLI
The CLI is the primary operator surface for AOR. It must remain usable when the web UI is absent.

## Guided installed-user layer
The guided layer targets the first-run vocabulary defined in `docs/product/02-installed-user-onboarding-journey.md`:
- `aor doctor` for environment and repository readiness;
- `aor onboard <repo>` for project bootstrap and asset-mode setup;
- `aor mission create` for product goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode;
- `aor next` for deterministic next-action guidance;
- `aor app` for launching the optional local web console.
- `aor request create/run/status` for runtime-owned operator interventions from any stage.

These are wrappers over runtime-owned command families. They must not remove or rename existing grouped commands, and they must keep ids, packet refs, report refs, blockers, and evidence locations visible.

W21-S02 implements the first-run shell for `doctor`, `onboard`, `app`, and `next`. These shortcuts default to human-readable output for installed users and accept `--json` when scripts need machine-readable fields. `onboard` delegates to `project init`; W21-S03 makes that path clean-repo safe by defaulting to bundled registry roots, writing the generated profile under `.aor/`, and emitting an onboarding report. W31-S01 changes the public `aor app` behavior from guidance to a foreground local app launcher backed by the same control-plane routes; `ui attach` and `ui detach` remain lower-level lifecycle commands. `next` writes the deterministic next-action report used by CLI/API/web surfaces.

`aor app` launcher semantics:
- default host is `127.0.0.1`; default port `0` asks the OS for a free local port;
- `--open true|false` controls browser launch;
- `--smoke --open false --json` starts the server, checks `/`, `/app-config.json`, and `GET /api/projects/:projectId/state`, prints JSON, then exits;
- the foreground server is stopped by `Ctrl+C` or process termination;
- the packaged UI can submit `mission create` and `next` through `POST /api/projects/:projectId/lifecycle-command/actions`, but orchestration remains owned by runtime command handlers.
- the packaged UI can create and run operator requests through `POST /api/projects/:projectId/operator-requests` and `POST /api/projects/:projectId/operator-requests/:requestId/actions`, preserving the same scope and delivery-mode checks as the CLI.

Operator request command semantics:
- `aor request create` stores raw request text only in durable `operator-request` evidence and exposes sanitized summaries in read surfaces;
- `aor request run` compiles `packet://operator-request@...` into the selected target step, applies the `operator-intervention` context bundle, materializes proposal/patch evidence, and refreshes `next-action-report`;
- `aor request status` reads sanitized status and refs without becoming a chat surface;
- `aor run steer` remains a run-control transition and does not accept arbitrary operator work text.

## Operator lifecycle
1. initialize or inspect the project profile
2. bootstrap and analyze / validate / verify the target project
3. optionally launch `aor app` for local guided intake and live inspection
4. create or ingest feature-specific work
5. create bounded operator requests for analysis, explanation, document proposals, validation, repair, or review when the operator needs runtime help before the next transition
6. inspect packets and approvals
7. start, pause, resume, steer, or cancel execution runs
8. inspect evidence, review verdicts, and quality outputs
9. launch eval or harness workflows
10. prepare delivery or release output
11. open incidents, audit runs, and close learning handoff

## UX rules
- commands should reflect the packet-first model;
- flags should be explicit;
- risky actions should expose approval or dry-run modes;
- the CLI must surface run ids, packet ids, and evidence locations clearly.

`aor project verify --routed-dry-run-step <step_class>` remains the baseline smoke path for routed no-write execution and durable step-result emission. The full-journey live path additionally uses public `review run` and `learning handoff` surfaces after real execution.

Installed-user proof for AOR itself runs through the internal `scripts/live-e2e/*` proof runner and is not part of the public CLI command surface.

Guided installed-user proof is separate from the internal proof runner. The proof runner can rehearse the guided vocabulary, but public guided commands still have to delegate to stable CLI/runtime paths and preserve no-upstream-write defaults.

## Interactive continuation rule
Runner-requested questions are operator interventions, not a separate UI workflow. CLI, API, and web surfaces all read the same `step-result.requested_interaction` evidence and submit answers through the control plane so answer audit refs and run-state transitions stay durable. Resumable checkpoints move to `interaction_status=resumed` with `continuation.next_action=continue_run`; non-resumable boundaries remain blocked with explicit evidence.
