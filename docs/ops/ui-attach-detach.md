# UI attach / detach

AOR is headless-first. The web UI is optional and its lifecycle is explicit through `aor ui attach` and `aor ui detach`.

## Attach
Connected attach:
```bash
aor ui attach \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --control-plane http://localhost:8080
```

Note: when a reachable `--control-plane` URL is provided, connected mode uses detached transport for:
- read/follow (`GET` + SSE);
- bounded mutation actions (`POST /api/projects/:projectId/run-control/actions`, `POST /api/projects/:projectId/ui-lifecycle/actions`, `POST /api/projects/:projectId/lifecycle-command/actions`, and `POST /api/projects/:projectId/interactions/answers`).
Without a control-plane URL, attach remains disconnected/read-model mode while headless workflows stay available.

Disconnected/read-model attach (no control-plane URL):
```bash
aor ui attach \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID>
```

Expected output checks:
- `ui_lifecycle_action: "attach"`;
- `ui_lifecycle_state.ui_attached: true`;
- `ui_lifecycle_connection_state: "connected"` or `"disconnected"`;
- repeated identical attach returns `ui_lifecycle_idempotent: true`.

## Detach
```bash
aor ui detach \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID>
```

Expected output checks:
- `ui_lifecycle_action: "detach"`;
- `ui_lifecycle_state.ui_attached: false`;
- `ui_lifecycle_connection_state: "detached"`;
- repeated detach returns `ui_lifecycle_idempotent: true`.

## Headless safety checks
After detach, verify headless paths still work:
```bash
aor run status --project-ref <AOR_WORKSPACE> --run-id <RUN_ID> --follow true
```

For local detachable web smoke path:
```bash
node apps/web/scripts/operator-console-smoke.mjs \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --follow true \
  --output-html .aor/web/operator-console-<RUN_ID>.html
```

Expected smoke outcome:
- JSON summary reports `mode=detachable-web-console` and `detached=true`;
- rendered HTML exists under `.aor/web/`;
- run/evidence read surfaces stay available with UI detached.

## Detached mutation smoke (optional)
Run-control mutation over detached transport:
```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"action":"start","run_id":"RUN-201"}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/run-control/actions
```

UI lifecycle detach over detached transport:
```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"action":"detach","run_id":"RUN-201"}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/ui-lifecycle/actions
```

Lifecycle command over detached transport:
```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"command":"intake create","flags":{"request_title":"Connected intake","request_brief":"Operator-submitted lifecycle mutation."}}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/lifecycle-command/actions
```

Interaction answer over detached transport:
```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"run_id":"RUN-201","interaction_id":"question-1","answer":"Use the approved staging target.","reason":"operator selected safe target"}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/interactions/answers
```

Mutation error-shape checks:
- malformed JSON returns `error.code: "invalid_json"`;
- unsupported action returns `error.code: "invalid_run_control_action"`, `error.code: "invalid_ui_lifecycle_action"`, or `error.code: "invalid_lifecycle_command"`;
- missing lifecycle command flags return `error.code: "invalid_lifecycle_flags"`;
- policy/transition block returns HTTP `409` with `error.code` in the `run_control.blocked` family and a durable `run_control.audit_file`.
- lifecycle policy/validation blocks return HTTP `409` with `error.code` in the `lifecycle_command.*` family and the original CLI `command_output` preserved.
- accepted interaction answers with resumable checkpoints return HTTP `200` and `interaction_answer.interaction_status="resumed"`; non-resumable boundaries return HTTP `409` with `error.code: "interaction.continuation_blocked"` plus `interaction_answer.answer_audit_ref`.

## Full-flow console checks
The detachable operator console must drive connected lifecycle actions through the control plane. Smoke the web module paths with:
```bash
node apps/web/scripts/operator-console-smoke.mjs \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --control-plane http://127.0.0.1:8080 \
  --output-html .aor/web/operator-console-<RUN_ID>.html
```

Expected full-flow console evidence:
- rendered HTML includes guided lifecycle, lifecycle command, and runner interaction sections;
- `guided_lifecycle.stages` covers readiness, mission, discovery/spec/plan, execution, review/QA, delivery/release, and learning;
- `guided_lifecycle` shows each stage status, evidence count/refs, blocker codes, policy-history count, event-history count, and the exact current next action from `next-action-report`;
- final stages include `closure_state` and `safety_gates`: review decision, delivery gate status, downstream block flag, delivery blocked reasons, release-packet status, learning status, and the same evidence chain returned by CLI/API;
- connected stage mutations use `POST /api/projects/:projectId/lifecycle-command/actions`; `mission create` creates guided intake evidence and `next` refreshes the durable next-action report;
- `contract_alignment.mutation_model` includes `POST /api/projects/:projectId/lifecycle-command/actions` and `POST /api/projects/:projectId/interactions/answers`;
- `contract_alignment.read_model` includes `GET /api/projects/:projectId/next-action-report`;
- pending runner questions are derived from `step-result.requested_interaction`;
- submitted answers return `interaction_answer.answer_audit_ref` and live/event-history payloads reference that audit ref without raw answer text;
- detaching the session stops web follow capture only; run state and evidence remain queryable through CLI/API.

Closure branch checks:
- missing review evidence selects `aor review run --run-id <RUN_ID>`;
- review evidence without a decision selects `aor review decide --decision approve`, while the UI still shows that `hold` and `request-repair` are durable decision choices;
- `hold` and `request-repair` decisions set `guided_lifecycle.state=blocked` and preserve the review-decision ref in stage evidence;
- delivery and release recommendations include `--require-review-decision`;
- release-ready evidence selects `aor learning handoff --run-id <RUN_ID>`;
- completed learning handoff changes the primary action to evidence inspection rather than another mutation.

Read-only checks:
- open a snapshot with read-only mode when mutation transport is unavailable or intentionally disabled;
- verify `guided_lifecycle.state=read_only`;
- stage evidence, blockers, policy history, live/event history, and next-action report refs remain visible;
- mutation descriptors report `available=false` without removing the exact CLI command the operator can run headlessly.

## Auth-enabled detached mode
If detached transport auth is enabled, pass bearer token on every read/follow/mutation request:
```bash
curl -sS \
  -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/state
```

Mutation requests use the same bearer header and require `mutate` permission:
```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{"command":"intake create","flags":{"request_title":"Authenticated intake"}}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/lifecycle-command/actions
```

Auth failure checks:
- missing or invalid token returns HTTP `401` with `error.code` in `auth.missing_credentials | auth.invalid_token`;
- project mismatch or missing permission returns HTTP `403` with `error.code` in `auth.forbidden_project | auth.insufficient_permission`;
- auth error payload includes `error.auth.required_permission` and `error.auth.project_id` for troubleshooting.
