# CLI and operator flow

## Role of the CLI
The CLI is the primary operator surface for AOR. It must remain usable when the web UI is absent.

## Operator lifecycle
1. initialize or inspect the project profile
2. analyze / validate / verify the target project
3. create or ingest work
4. inspect packets and approvals
5. start, pause, resume, steer, or cancel runs
6. inspect evidence and quality outputs
7. launch eval or harness workflows
8. prepare delivery or release output
9. open incidents and review promotion decisions

## UX rules
- commands should reflect the packet-first model;
- flags should be explicit;
- risky actions should expose approval or dry-run modes;
- the CLI must surface run ids, packet ids, and evidence locations clearly.

`aor project verify --routed-dry-run-step <step_class>` is the baseline smoke path for routed no-write execution and durable step-result emission.

Installed-user proof for AOR itself runs through the internal `scripts/live-e2e/*` harness and is not part of the public CLI command surface.
