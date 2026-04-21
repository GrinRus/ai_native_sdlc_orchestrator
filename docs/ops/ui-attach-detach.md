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

## Detach
Detaching the UI must not:
- stop workflows;
- block API access;
- remove logs or evidence;
- change workflow state.

## Operator checks
Before calling UI behavior done, confirm that:
- the API still responds with live state;
- SSE or event streams continue while the UI is disconnected;
- reconnecting the UI can catch up from the read model plus live stream.
