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
- bounded mutation actions (`POST /api/projects/:projectId/run-control/actions` and `POST /api/projects/:projectId/ui-lifecycle/actions`).
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

Mutation error-shape checks:
- malformed JSON returns `error.code: "invalid_json"`;
- unsupported action returns `error.code: "invalid_run_control_action"` or `error.code: "invalid_ui_lifecycle_action"`;
- policy/transition block returns HTTP `409` with `error.code` in the `run_control.blocked` family and a durable `run_control.audit_file`.
