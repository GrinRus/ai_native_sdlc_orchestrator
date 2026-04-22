# Runbook index

## Live E2E rehearsal profiles
- `live-e2e-target-catalog.md` — canonical target repositories, setup commands, and scenario briefs.
- `live-e2e-dependency-matrix.md` — canonical dependencies for setup and verification across all live E2E profiles.
- `live-e2e-regress-short.md` — fast smoke rehearsal on a small public repository.
- `live-e2e-regress-long.md` — deeper regression rehearsal with stronger verification.
- `live-e2e-release-short.md` — short release rehearsal that still materializes a release packet.
- `live-e2e-release-long.md` — long monorepo release rehearsal with stronger gates.
- `live-e2e-standard-runner.md` — standard start/status/report/abort surfaces for catalog profiles.
- `live-e2e-learning-loop.md` — repeatable scorecard/incident capture and backlog-quality handoff flow.
- `github-fork-first-delivery.md` — fork-first delivery checkpoints, approval boundaries, and recovery guidance.
- `live-run-event-stream.md` — replay-safe stream behavior, reconnect flow, and backpressure baseline.

## Run control
- `run-control-lifecycle.md` — start/pause/resume/steer/cancel commands, guardrails, and audit checks.
- `incident-audit-operations.md` — incident open/show and audit runs command flow with run-linked evidence checks.

## UI lifecycle
- `ui-attach-detach.md` — how to attach or detach the optional web UI from a running AOR system.

## Profile selection rule of thumb
- Need a fast smoke signal: `regress short`
- Need a stronger regression signal: `regress long`
- Need a quick release-shaped rehearsal: `release short`
- Need a production-like monorepo rehearsal: `release long`
