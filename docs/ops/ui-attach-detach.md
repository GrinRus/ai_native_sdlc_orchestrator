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

Note: when a reachable `--control-plane` URL is provided, connected mode reads/follow use the detached HTTP/SSE transport baseline. Without it, attach remains disconnected/read-model mode while headless workflows stay available.

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
