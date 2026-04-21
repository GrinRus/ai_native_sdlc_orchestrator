# Control plane API

## Purpose
The API exposes command, query, and live-stream surfaces for AOR.

## Command families
- project bootstrap commands
- intake and planning commands
- approval commands
- run lifecycle commands
- eval and harness commands
- delivery and release commands
- incident and promotion commands
- live E2E commands

## Query families
- projects
- packets
- runs
- step results
- validation and evaluation reports
- delivery manifests and release packets
- incidents and promotion decisions
- live E2E reports

## Read endpoints (W5-S01 baseline)
- `GET /api/projects/:projectId/state` — project runtime state and layout references.
- `GET /api/projects/:projectId/packets` — packet artifacts (`artifact-packet`, `wave-ticket`, `handoff-packet`, `delivery-plan`, `delivery-manifest`, `release-packet`).
- `GET /api/projects/:projectId/step-results` — `step-result` artifacts from reports.
- `GET /api/projects/:projectId/manifests` — delivery-manifest artifacts.
- `GET /api/projects/:projectId/promotion-decisions` — promotion-decision artifacts.
- `GET /api/projects/:projectId/quality-artifacts` — validation/evaluation reports and promotion decisions.
- `GET /api/projects/:projectId/runs` — aggregated run-level view derived from packet, step-result, and quality artifact references.

All read responses must reuse existing contract families and IDs rather than API-only parallel shapes.

## Authentication and permission assumptions
- Baseline assumption for local/operator rehearsals: trusted local operator context behind workspace access controls.
- Read endpoints are read-only and must not mutate runtime artifacts.
- Production deployments should require authenticated identity with project-scoped read permissions before exposing packet or evidence references.
- Endpoint responses should preserve `evidence://` or runtime-relative refs for audit traceability; do not return secrets or raw credential material.

## Streaming
The API should provide SSE-first live events so CLI and web can observe active work without owning workflow state.

## Streaming endpoint (W5-S02 baseline)
- `GET /api/projects/:projectId/runs/:runId/events`
  - transport: SSE (or equivalent stream abstraction with the same event contract);
  - event contract: `live-run-event`;
  - query: `after_event_id` for replay from the last acknowledged event;
  - query: `max_replay` for bounded catch-up window.

Expected event types:
- `run.started`
- `step.updated`
- `evidence.linked`
- `warning.raised`
- `run.terminal`

Reconnect and backpressure baseline:
- replay from `after_event_id` when provided;
- bounded replay window (do not allow unbounded buffers);
- preserve monotonic per-run event ordering via payload sequence.

## Key design rules
- keep the API usable without the web UI;
- keep ids and references visible in responses;
- expose explicit approval and dry-run paths for risky actions;
- keep command and query shapes aligned with the contract docs and CLI catalog.
