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
- optional local web UI for dashboards, guided Mission intake, and drill-down views
- API queries for automation and integrations

## Local app launch

`aor app` starts a local loopback web console from the installed package. The
same process serves:
- `/` for the packaged SPA;
- `/app-config.json` for project id, project ref, runtime root, package version, and API base;
- `/api/projects/:projectId/**` for the existing control-plane read, mutation, and SSE routes.

The app can submit the first Mission form through
`POST /api/projects/:projectId/lifecycle-command/actions` with
`command: "mission create"`, then invoke `next` to refresh the durable
`next-action-report`. It does not own run-state transitions, answer
continuation, review decisions, or delivery gates.

Release and live E2E smoke for the web surface uses
`aor app --smoke true --open false --json`, which loads the real SPA,
`/app-config.json`, and control-plane state route. A generated static HTML
snapshot is not a supported operator console or proof path.

The app can also submit operator-initiated interventions through
`POST /api/projects/:projectId/operator-requests` and run them through
`POST /api/projects/:projectId/operator-requests/:requestId/actions` with
`action=run`. Read views use `GET /api/projects/:projectId/operator-requests`
and must show sanitized summaries and refs, not raw request text. Successful
runs refresh/materialize `next-action-report` so the right rail and headless
CLI/API surfaces converge on the same next action.

## Flow-centric local view

The W34 local console uses flow projections from the control plane instead of
browser-owned lifecycle state. The flow selector, active-flow cockpit,
completed-flow history, and flow-scoped advanced views all read stable
`flow_id`, `status`, `selected_stage`, evidence refs, and write-back policy
from runtime artifacts.

Connected UI actions may select a flow, create an operator request for that
flow, or start `New Flow` through lifecycle-command mutations. They must not
mutate completed flow evidence, infer a selected flow from local storage, or
create a follow-up without durable mission/intake and next-action evidence.

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
