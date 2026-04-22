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
- `GET /api/projects/:projectId/quality-artifacts` — validation/evaluation reports, incident reports, and promotion decisions.
- `GET /api/projects/:projectId/runs` — aggregated run-level view derived from packet, step-result, and quality artifact references.

All read responses must reuse existing contract families and IDs rather than API-only parallel shapes.

## Run-control command endpoints (W6-S03 baseline)
- `POST /api/projects/:projectId/runs/:runId/start`
- `POST /api/projects/:projectId/runs/:runId/pause`
- `POST /api/projects/:projectId/runs/:runId/resume`
- `POST /api/projects/:projectId/runs/:runId/steer`
- `POST /api/projects/:projectId/runs/:runId/cancel`

Command payload baseline:
- `reason` (optional text summary for operator intent);
- `target_step` (required for `steer` scope, blocked when missing);
- `approval_ref` (required by high-risk policy guardrails when applicable).

Deterministic transition baseline:
- `start` creates/opens `running` lifecycle;
- `pause` allowed only from `running`;
- `resume` allowed only from `paused`;
- `steer` allowed from `running|paused` with explicit target step;
- `cancel` allowed from `running|paused`, resulting in terminal `canceled`.

Guardrail baseline:
- high-risk controls (`steer`, `cancel`) must evaluate `approval_policy` + `risk_tiers` before apply;
- blocked actions must still emit durable audit evidence and warning-style live-run event payloads.

Durable audit baseline:
- every control action writes one durable `run-control-event-*.json` record under runtime reports;
- control records must include `run_id`, `action`, transition snapshot, guardrail decision, and `evidence_root`.

## Delivery/release command endpoints (W6-S05 baseline)
- `POST /api/projects/:projectId/delivery/prepare`
- `POST /api/projects/:projectId/release/prepare`

Delivery/release payload baseline:
- `run_id` (optional command-scoped run identity; deterministic fallback when omitted);
- `step_class` (optional, defaults to `implement`);
- `mode` (optional override; canonicalized aliases map to `no-write | patch-only | local-branch | fork-first-pr`);
- `approved_handoff_ref` (optional evidence ref required by non-`no-write` preconditions);
- `promotion_evidence_refs` (optional comma/list refs required by non-`no-write` preconditions).

Delivery/release guardrail baseline:
- resolve policy bounds before materializing delivery/release artifacts;
- non-`no-write` flows must remain blocked when approved handoff or promotion evidence is missing;
- `release prepare` must fail fast with explicit precondition blocking reasons and must not bypass delivery-plan guardrails.

Delivery/release response baseline:
- `delivery_plan_file` and `delivery_plan_status` for policy traceability;
- `delivery_manifest_file` and `release_packet_file` as durable evidence outputs;
- `delivery_writeback_result` to distinguish `no-write-confirmed`, `patch-materialized`, `local-branch-committed`, and `fork-pr-planned`.

## Incident/audit command endpoints (W6-S06 baseline)
- `POST /api/projects/:projectId/incidents`
- `GET /api/projects/:projectId/incidents`
- `GET /api/projects/:projectId/audit/runs`

Incident open payload baseline:
- `run_id` (required run linkage for the incident lifecycle);
- `summary` (required operator summary);
- `severity` (optional level, defaults to `high`);
- `status` (optional state, defaults to `open`);
- `linked_asset_refs` (optional explicit evidence refs).

Incident open response baseline:
- durable `incident_file` path for one contract-valid `incident-report`;
- `incident_run_ref` and `incident_linked_asset_refs` for explicit run/evidence traceability.

Incident show baseline:
- supports bounded lookup by `incident_id` or `run_id`;
- missing lookup targets return explicit not-found errors for operator diagnostics.

Incident recertify baseline (W7-S03):
- `incident recertify` applies one of `recertify|hold|re-enable` to a durable `incident-report`;
- re-enable is blocked unless linked promotion evidence is present with `status=pass`;
- recertification updates persist transition provenance (`from_status`, `to_status`, run/promotion refs, evidence root).

Audit runs baseline:
- emits run-centric snapshots of packet, step-result, quality, incident, and promotion refs;
- emits `run_audit_records.finance_evidence` with route/wrapper/adapter IDs plus bounded cost/timeout/latency summaries;
- supports optional `run_id` filter and bounded `limit` window;
- response includes `audit_evidence_refs` for downstream handoff and review workflows.

## UI lifecycle endpoints (W6-S04 baseline)
- `POST /api/projects/:projectId/ui/attach`
- `POST /api/projects/:projectId/ui/detach`
- `GET /api/projects/:projectId/ui/state`

UI lifecycle payload baseline:
- `run_id` (optional operator context);
- `control_plane` (optional URL for connected mode).

UI lifecycle response baseline:
- `ui_attached` boolean;
- `connection_state` in `connected | disconnected | detached`;
- `idempotent` marker for repeated attach/detach retries;
- `headless_safe=true` to assert CLI/API paths remain usable while UI is detached.

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

## API/UI alignment notes (W5-S04 baseline)
- The detachable web console reads run and evidence state from the same query families used by CLI:
  - run list: `GET /api/projects/:projectId/runs`;
  - run detail packets and evidence: `GET /api/projects/:projectId/packets`, `GET /api/projects/:projectId/step-results`, `GET /api/projects/:projectId/quality-artifacts`.
- Live follow in web mode reuses the same stream endpoint and parameters:
  - `GET /api/projects/:projectId/runs/:runId/events?after_event_id=...&max_replay=...`.
- Detach behavior is UI-local only:
  - detaching unsubscribes the web listener;
  - active runs and runtime artifacts remain owned by orchestrator runtime, not by UI process.

## Key design rules
- keep the API usable without the web UI;
- keep ids and references visible in responses;
- expose explicit approval and dry-run paths for risky actions;
- keep command and query shapes aligned with the contract docs and CLI catalog.
