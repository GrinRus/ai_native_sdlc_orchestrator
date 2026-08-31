# Installed-user first run

## Purpose

This runbook covers the supported npm-alpha first run through the packaged
Task Workspace. The web app is optional: CLI and API surfaces remain usable
without it, and the browser never owns lifecycle state or execution policy.

## Install and launch

```sh
AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"
npm install -g "@grinrus/aor@$AOR_VERSION"
aor --help
cd <repo>
aor app
```

`aor app` starts a foreground loopback server, opens the browser by default,
and prints the local URL. Press `Ctrl+C` in that terminal to stop it. Mutable
AOR state lives under `~/.aor`; use `AOR_HOME` only for tests or an
intentionally isolated run. Merely loading Task Workspace does not create a
repository-local `.aor/` directory or modify tracked project files.

## Task Workspace path

1. Confirm the active project in the left navigation. Use the project control
   only to switch to an explicitly connected project or add a local Git folder
   or HTTPS/SSH Git URL.
2. Select **New task**.
3. Describe the intended outcome in plain language. Optionally attach a UTF-8
   Markdown file or pin repository Markdown with a base revision.
4. Select **Prepare task**. Preparation is read-only and creates a
   server-owned Task projection backed by immutable intent evidence.
5. Review the normalized outcome, pinned sources, runner readiness, and safety
   mode. Select **Start task** only when the displayed Task is correct.
6. Follow the runtime-owned lifecycle path. Use Attention and Review surfaces
   when the server publishes a blocker or review action.
7. Treat a completed Task as read-only. Create a follow-up Task instead of
   reopening or mutating completed evidence.

`Flow` remains an internal lineage identifier in APIs and evidence. It is not
a user-selectable renderer or a parallel navigation surface in the packaged
app.

## First-run state matrix

| State | Primary UI surface | Expected action | Runtime/evidence boundary |
| --- | --- | --- | --- |
| No Task yet | Tasks Home | Select **New task** and describe the outcome. | Loading the app is read-only; no runtime or target-repository state is created. |
| Local draft | New Task | Add optional Markdown and select **Prepare task**. | Unsaved form state is browser-local and cannot start execution. |
| Prepared | Prepared Task | Review immutable sources, runner readiness, and safety; select **Start task**. | The server owns Task revision and action availability. |
| Active | Active Task Workspace | Follow the published primary action or create a bounded no-write request. | Lifecycle transitions and evidence remain runtime-owned. |
| Needs attention | Attention | Resolve the published blocker or use the offered recovery action. | The browser must not infer progress from partial data. |
| Review required | Review Changes | Inspect recorded changes and choose an available review decision. | Approval requires current deterministic verification and review evidence. |
| Completed | Completion & Evidence | Inspect immutable closure evidence or create a follow-up Task. | Completed Task evidence cannot be edited or restarted. |
| Multiple projects | Project dialog | Switch by project label/id or connect one explicit source. | Task and evidence state remains isolated by workspace project ID. |

## Packaged app smoke contract

Use the smoke path after a local build or publication:

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

Run the registry smoke from a neutral directory. Running it inside the AOR
source checkout can cause npm to resolve the local package context instead of
the published binary.

The JSON result must include:

```json
{
  "status": "smoke-pass",
  "html_loaded": true,
  "task_workspace_loaded": true,
  "new_task_action_loaded": true,
  "prepare_task_action_loaded": true,
  "project_switcher_loaded": true,
  "legacy_surface_absent": true
}
```

The smoke also checks `/app-config.json`, `GET /api/projects`, and
`GET /api/projects/:projectId/state`; their project identifiers must agree.
The check is a deterministic packaging guard, not a substitute for browser
acceptance.

## Installed browser acceptance

`pnpm test:web:browser` packs the current package, installs it into a
disposable prefix, launches it from a neutral directory with a disposable
`AOR_HOME`, and exercises Task Workspace through the same-origin control plane.
The blocking proof covers:

- clean-project default routing without `?surface=tasks`;
- Tasks Home, preparation, start, active work, attention, review, completion,
  reload, offline recovery, keyboard use, and responsive layouts;
- immutable Markdown snapshots and repository-source revision pins;
- completed-Task immutability and explicit follow-up creation;
- no external browser requests, target-source writes, or upstream writes.

The executable fixture is
`apps/web/browser/fixtures/task-workspace-closure.json`; current proof context
is recorded in `docs/research/24-w70-installed-task-workspace-closure.md`.
Older Quiet Cockpit and Flow-console artifacts under `docs/research/` and
historical browser fixtures are release-history evidence, not current
installed-user instructions.

## Headless equivalents

The supported headless task path is:

```sh
aor project connect --path <repo>
aor task prepare --project-id <project-id> --request "Describe the outcome"
aor task start --project-id <project-id> --submission-id <submission-id>
```

Use `aor next --project-ref <repo> --json` when automation needs the durable
next-action report. Readiness, blockers, write-back policy, and evidence refs
must come from runtime reports, not from the presence or absence of a browser
button.

## Recovery

- If Task data is unavailable, use **Retry**; do not infer a lifecycle state
  from stale cached content.
- If preparation reports stale repository Markdown, repin the source revision
  and prepare a new Task revision.
- If a runner is unavailable, choose only a route offered by the server-owned
  recovery surface.
- If review evidence is incomplete, keep approval disabled and run the
  published verification/review action.
- If the browser exits, restart `aor app`; active runs and evidence remain
  owned by the headless runtime.

## Safety boundary

- The browser uses only same-origin control-plane reads and structured
  mutations.
- No provider process starts during read-only preparation.
- The default public-repository delivery posture is patch-only/no-upstream-write.
- Raw secrets, private paths, target contents, and credential-bearing `.aor/`
  artifacts must not be pasted into public issues or logs.
- Explicit materialization/export actions are the only supported reasons for
  writing portable AOR data into a target repository.
