# Task action catalog

The Task Workspace mutation route is driven by one server-owned catalog at
`packages/orchestrator-core/src/control-plane/task-action-catalog.mjs`.
Transports and clients must treat `action_id` as an opaque typed identifier and
must not maintain their own lifecycle allowlist or infer mutations from a shell
command.

Each catalog entry publishes:

- `category`: `mutation`, `workbench`, `evidence`, or `refresh`;
- `permission`: `mutate` for state-changing actions, otherwise `read`;
- `dispatch`: the server-owned mutation/readback boundary;
- `payload`: field names, scalar types, enum values, and requiredness;
- `requires_confirmation` and, for lifecycle actions, the canonical command.

The public Task action request always contains `action`. CAS-protected actions
carry the displayed non-negative `expected_revision`. Successful mutations
return a `readback` object containing the refreshed Task projection, stable
intent/Mission/Flow/run lineage, current state and revision, and evidence refs.
Blocked actions return the same typed error envelope and a catalog recovery
action; they never claim Active or Completed without durable server evidence.

The catalog currently covers intent start/confirmation, task runner selection,
run control, durable operator requests, follow-up creation,
discovery/specification/planning,
approval, review, delivery, release, learning, repair, inspection, and
completion paths. New primary actions must be added here first, then covered by
catalog parity tests and the S14 UI wiring handoff.

`review-quality-repair` reruns review against the completed repair run selected
by the current server-published action. The API consumes its structured
`operator_control.operation`; callers do not choose or copy the run ID.
`run-review-quality-repair` and `run-qa-quality-repair` start the requested
implementation repair, while `qa-quality-repair` starts post-repair QA. These
no-payload actions execute only their server-published structured operation,
including its run ID, target step, and selected evidence refs.

A successful `follow-up` response includes the full durable readback of the
completed source Task and `new_intent_submission_id`. Clients use that
submission ID to follow the new Task projection through preparation; they do
not infer a new Task ID from the source Task.

`select-runner` and `reset-runner` are available only for a prepared,
intent-backed Task. They use the submission lock and require both the displayed
normalization `expected_revision` and `expected_selection_revision`. Selecting
a route stores an approved canonical route ID on that submission; resetting
removes the override and restores the project default. Runner selection never
changes the project profile.

`start` carries both the displayed normalization `expected_revision` and
`expected_selection_revision`. The latter prevents a stale Task view from
starting after another client changes its route selection. Headless callers can
select a route at start with `aor task start --route <route_id>`; the CLI saves
the same task-scoped override and checks its current readiness before start.
Use `--use-project-default true` to clear a previously saved task override.

Task Workspace `request` and `retry` actions persist an idempotent
`run-pending` operator request before running it through the shared runtime.
They return the runtime result or a durable recovery state. The UI reads the
sanitized operator-request list and offers `Resume request` for unfinished
requests; the resume action uses the same request-run endpoint as API and CLI
clients. Creating a different request or retry for the same Task while an
existing request is `created`, `run-pending`, or `running` returns
`409 operator_request.unfinished_exists`. The server checks this under the
request transaction lock; same-key replay with the same inputs still resolves
to the existing request. The UI disables request and retry controls when the
sanitized request list is unavailable.

Task run-control actions (`pause`, `resume`, `steer`, and `cancel`) accept an
optional `command_id`, `expected_revision`, `reason`, and `approval_ref`, in
line with the run-control API. `steer` requires `target_step` from the shared
`step_class` enum and uses the same guardrails as `aor run steer`. The server
generates a fresh command id when one is omitted, so later pause/resume cycles
and separate steering requests remain distinct. Supplying the same
`command_id` and payload replays that specific control request.
