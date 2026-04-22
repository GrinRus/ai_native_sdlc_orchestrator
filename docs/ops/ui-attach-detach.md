# UI attach / detach

AOR is headless-first. The web UI is an optional operator surface that can attach to a running system and detach without interrupting active work.

## Attach
Use the UI when you need:
- a live run timeline;
- packet and evidence inspection;
- approval and incident views;
- live E2E dashboards.

Typical attach flow:
```bash
aor ui attach --run RUN-201 --control-plane http://localhost:8080
```

Local detachable web console smoke path:
```bash
node apps/web/scripts/operator-console-smoke.mjs \
  --project-ref . \
  --run-id RUN-201 \
  --follow true \
  --output-html .aor/web/operator-console-RUN-201.html
```

Expected smoke outcome:
- emits a JSON transcript with `mode=detachable-web-console`;
- renders an HTML console snapshot under `.aor/web/`;
- follows live events through the shared control-plane stream contract.

## Detach
Detaching the UI must not:
- stop workflows;
- block API access;
- remove logs or evidence;
- change workflow state.

When using the local smoke script, detach is explicit and always reported in the JSON summary (`detached: true`).

## Operator checks
Before calling UI behavior done, confirm that:
- the API still responds with live state;
- SSE or event streams continue while the UI is disconnected;
- reconnecting the UI can catch up from the read model plus live stream.
- headless CLI paths (for example `aor run status --follow`) still work with the web UI stopped.
