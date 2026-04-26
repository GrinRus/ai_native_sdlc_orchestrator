# CLI and operator flow

## Role of the CLI
The CLI is the primary operator surface for AOR. It must remain usable when the web UI is absent.

## Operator lifecycle
1. initialize or inspect the project profile
2. bootstrap and analyze / validate / verify the target project
3. create or ingest feature-specific work
4. inspect packets and approvals
5. start, pause, resume, steer, or cancel execution runs
6. inspect evidence, review verdicts, and quality outputs
7. launch eval or harness workflows
8. prepare delivery or release output
9. open incidents, audit runs, and close learning handoff

## UX rules
- commands should reflect the packet-first model;
- flags should be explicit;
- risky actions should expose approval or dry-run modes;
- the CLI must surface run ids, packet ids, and evidence locations clearly.

`aor project verify --routed-dry-run-step <step_class>` remains the baseline smoke path for routed no-write execution and durable step-result emission. The full-journey live path additionally uses public `review run` and `learning handoff` surfaces after real execution.

Installed-user proof for AOR itself runs through the internal `scripts/live-e2e/*` proof runner and is not part of the public CLI command surface.
