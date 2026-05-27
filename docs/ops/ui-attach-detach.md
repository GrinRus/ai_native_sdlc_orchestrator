# UI attach / detach

AOR is headless-first. The web UI is optional. Installed users normally start it with `aor app`; lower-level lifecycle state remains explicit through `aor ui attach` and `aor ui detach`.

## Local app launcher

Use this for the installed-user UI:
```bash
aor app \
  --project-ref <repo> \
  --runtime-root <repo>/.aor \
  --host 127.0.0.1 \
  --port 0 \
  --open true
```

Expected behavior:
- the command starts a foreground loopback server and prints the local URL;
- `/` serves the packaged SPA;
- `/app-config.json` returns project id, project ref, runtime root, version, and API base;
- `/api/projects/:projectId/**` serves the same control-plane read, mutation, and SSE routes;
- the browser opens unless `--open false` is passed;
- `Ctrl+C` stops the app server without changing run state.

Release/CI smoke:
```bash
aor app --project-ref <repo> --runtime-root <repo>/.aor --smoke --open false --json
```

Expected smoke outcome:
- `status="smoke-pass"`;
- `html_loaded=true`;
- `config_project_id` and `state_project_id` match `project_id`;
- only `.aor/` runtime state changes in the target repository.

Local-alpha source checkouts use the detached API at `http://127.0.0.1:8080`
in CLI guidance and this runbook. This is a local operator control-plane path,
not a hosted service or production deployment claim.

## Local detached API smoke
Verify the local detached API transport from a source checkout:
```bash
node apps/api/scripts/control-plane-smoke.mjs \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --host 127.0.0.1 \
  --port 8080
```

Keep the local control-plane process running for attach and console checks:
```bash
node apps/api/scripts/control-plane-smoke.mjs \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --host 127.0.0.1 \
  --port 8080 \
  --serve true
```

Expected smoke outcome:
- status is `ready`;
- `base_url` is `http://127.0.0.1:8080`;
- `state_url` points to `/api/projects/<PROJECT_ID>/state`.

## Attach
Connected attach:
```bash
aor ui attach \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --control-plane http://127.0.0.1:8080
```

Note: when a reachable `--control-plane` URL is provided, connected mode uses detached transport for:
- read/follow (`GET` + SSE);
- bounded mutation actions (`POST /api/projects/:projectId/run-control/actions`, `POST /api/projects/:projectId/ui-lifecycle/actions`, `POST /api/projects/:projectId/lifecycle-command/actions`, `POST /api/projects/:projectId/operator-requests`, `POST /api/projects/:projectId/operator-requests/:requestId/actions`, and `POST /api/projects/:projectId/interactions/answers`).
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

The supported web readiness smoke is the real local app:
```bash
aor app \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --smoke true \
  --open false \
  --json
```

Expected smoke outcome:
- JSON summary reports `mode="local-spa"` and `status="smoke-pass"`;
- `html_loaded=true`;
- `config_project_id` and `state_project_id` match `project_id`;
- CLI/API/headless surfaces remain available when the app process exits.

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

Operator request create and run over detached transport:
```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"target_stage":"discovery","intent_type":"analyze","request_text":"Explain the latest blocker and propose the next safe action.","target_refs":["evidence://.aor/projects/<PROJECT_ID>/reports/next-action-report.json"],"delivery_mode":"no-write"}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/operator-requests

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"action":"run","target_step":"plan"}' \
  http://127.0.0.1:8080/api/projects/<PROJECT_ID>/operator-requests/<REQUEST_ID>/actions
```

Mutation error-shape checks:
- malformed JSON returns `error.code: "invalid_json"`;
- unsupported action returns `error.code: "invalid_run_control_action"`, `error.code: "invalid_ui_lifecycle_action"`, or `error.code: "invalid_lifecycle_command"`;
- missing lifecycle command flags return `error.code: "invalid_lifecycle_flags"`;
- policy/transition block returns HTTP `409` with `error.code` in the `run_control.blocked` family and a durable `run_control.audit_file`.
- lifecycle policy/validation blocks return HTTP `409` with `error.code` in the `lifecycle_command.*` family and the original CLI `command_output` preserved.
- invalid operator request scope, intent, stage, or delivery mode returns HTTP `400` with `error.code` in the `operator_request.*` family;
- accepted operator request reads omit raw `request_text` and return summaries, refs, status, result refs, and evidence refs only;
- accepted interaction answers with resumable checkpoints return HTTP `200` and `interaction_answer.interaction_status="resumed"`; non-resumable boundaries return HTTP `409` with `error.code: "interaction.continuation_blocked"` plus `interaction_answer.answer_audit_ref`.

## Full-flow console checks
The local app console must drive lifecycle actions through same-origin control-plane routes. Smoke the installed-user app path with:
```bash
aor app \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --smoke true \
  --open false \
  --json
```

Expected full-flow console evidence:
- app smoke loads the packaged SPA, `/app-config.json`, and `GET /api/projects/:projectId/state`;
- connected stage mutations use `POST /api/projects/:projectId/lifecycle-command/actions`; the SPA Mission form creates guided intake evidence and `next` refreshes the durable next-action report;
- Ask AOR/request-change actions use `POST /api/projects/:projectId/operator-requests` and `POST /api/projects/:projectId/operator-requests/:requestId/actions`;
- Evidence & Documents lets operators copy refs and attach refs as operator-request targets without opening raw mutable files;
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
- use CLI/API reads when mutation transport is unavailable or intentionally disabled;
- stage evidence, blockers, policy history, live/event history, and next-action report refs remain visible through headless commands;
- the local app must not become the only way to discover the exact CLI command an operator can run headlessly.

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
