# Realtime operations and live view

## Purpose
Operators need live state without making the UI part of the critical path.

## Design rules
- the runtime must stay headless-first;
- the API and event stream must work without the web UI;
- the local UI can launch late and catch up from the read model plus the live stream;
- detaching the UI must not change workflow state.
- connected UI actions must call control-plane command mutations and must not own orchestration decisions.
- production-hardened transport mode must authenticate every read, stream, and mutation route before handlers run.
- configured secrets must be redacted from live logs, SSE payloads, API payloads, and CLI JSON output.

## Live signal types
- run and step lifecycle events
- route and policy decisions
- approval requests
- runner-requested questions and answer audit refs
- operator-request creation, run, proposal, patch, and next-action refresh evidence
- validation, eval, and harness outcomes
- delivery and release milestones
- incident creation and follow-up actions

## Operator surfaces
- CLI for direct operational control
- optional local Task Workspace for preparation, runtime-owned actions, review, and evidence views
- API queries for automation and integrations

## Local app launch

`aor app` starts a local loopback web console from the installed package. The
same process serves:
- `/` for the packaged SPA;
- `/app-config.json` for workspace project id, default project id, project list, package version, and API base; AOR Home placement remains server-owned;
- `/api/projects` for local app-session project summaries;
- `/api/projects/:projectId/**` for the existing control-plane read, mutation, and SSE routes.

The app starts with one explicit project context from `--project-ref` or the
current working directory. Additional projects can be added only by explicit
operator input. The app does not scan the filesystem for projects, persist a
global recent-project list, or merge multiple `project_id` contexts into one
portfolio flow.

The app prepares intent-backed Tasks through
`POST /api/projects/:projectId/intent-submissions` and invokes only the actions
published by the Task projection. It does not own run-state transitions,
answer continuation, review decisions, or delivery gates.

Release and internal maintainer smoke for the web surface uses
`aor app --smoke true --open false --json`, which loads the real SPA,
`/app-config.json`, local project index, control-plane state route, Task
Workspace / New task / Prepare task / project-switcher markers, and the absence
of retired Quiet Cockpit markers. A generated static HTML snapshot is not a
supported operator console or proof path.

The app can also submit operator-initiated interventions through
`POST /api/projects/:projectId/operator-requests` and run them through
`POST /api/projects/:projectId/operator-requests/:requestId/actions` with
`action=run`. Read views use `GET /api/projects/:projectId/operator-requests`
and must show sanitized summaries and refs, not raw request text. Successful
runs refresh/materialize `next-action-report` so the right rail and headless
CLI/API surfaces converge on the same next action.

## Task-centric local view

The current local console uses Task projections from the control plane instead
of browser-owned lifecycle state. Tasks Home, Attention, Review, Completion,
and follow-up views read stable Task status, lifecycle path, evidence refs, and
write-back policy from runtime artifacts. An internal `flow_id` may scope
runtime evidence, but users do not select a parallel Flow renderer.

Connected UI actions may prepare, start, pause, resume, cancel, retry, request
bounded help, or create a follow-up only when the Task projection exposes that
action. They must not mutate completed evidence or infer a selected lifecycle
from browser storage.

When a W45 `quality-repair-request` is active, the flow projection exposes
`active_quality_gate` for the local console. The cockpit renders the request
ref, cycle id, source stage, request status, bounded attempt budget, blockers,
evidence summaries, and the resolver's single primary action. Review-origin
repair, QA-origin repair, and exhausted repair budgets are displayed as
operator-visible quality gates; delivery and release actions remain hidden
behind the gate until the request closes or an explicit exhausted-budget
operator hold/override is recorded by the runtime.

## Interactive continuation
When a runner asks a question, AOR treats it as a run continuation boundary:
- the routed step persists `step-result.requested_interaction` with a query-safe summary and evidence refs;
- live events announce the requested, answered, resumed, or blocked state without raw answer text;
- operator answers flow through a control-plane command path that writes answer audit evidence first;
- the runtime resumes from the recorded boundary or stays blocked with explicit evidence refs and reason codes.

The web UI may render the question and submit the answer, but it must not decide how to resume the run or store unaudited answer state.

## Production hardening baseline

`local-trusted` mode remains the default for loopback development and headless harness operation. `production-hardened` mode is available for detached HTTP/SSE operation and requires bearer principals with explicit `read` and `mutate` scopes.

Denied transport actions return stable `auth.*` reasons without invoking mutation handlers. Denied run-control actions that do reach policy guardrails still write run-control audit evidence, but configured secret values are redacted before audit/log emission so operators can review the reason without exposing token material.
