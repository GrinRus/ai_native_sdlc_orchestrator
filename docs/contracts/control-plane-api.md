# Control plane API

## Purpose
Define one control-plane surface for command, query, and live-stream operations while keeping the runtime headless-first.

## Current implementation binding (W5-W8 baseline)

Current code is **module-backed and in-process**, not detached HTTP transport:
- API surface is exported from `apps/api/src/index.mjs` as function operations.
- CLI and web consume those operations directly in-process.
- Contract and artifact semantics stay stable even before detached transport exists.

Implemented operation families:
- read: project state, packets, step results, manifests, promotion decisions, quality artifacts, runs, run event history, run policy history, strategic snapshot;
- run control: start/pause/resume/steer/cancel with guardrail enforcement and audit records;
- UI lifecycle: attach/detach/read state with headless-safe semantics;
- live events: append/read/open stream using the `live-run-event` contract family.

## Machine-checkable baseline (W9-S04)

The `control-plane-api` family is loader-covered with a machine-checkable baseline example:
- `examples/control-plane-api/module-surface-baseline.yaml`

Required top-level fields in the loader baseline:
- `api_id`, `version`, `binding_mode`, `deferred_transport_status`;
- `read_operations`, `run_control_operations`, `ui_lifecycle_operations`, `live_event_operations`;
- `deferred_transport`.

Current enum constraints:
- `binding_mode=module-in-process` for the current runtime reality;
- `deferred_transport_status=planned` until detached transport is implemented in `W9-S07`.

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

## Read surface baseline (module operations)

Read operations must reuse existing contract families and IDs rather than introducing API-only parallel shapes.

Run-level read baseline:
- run summaries include `context_lifecycle` when run-linked promotion decisions reference context assets, with context version refs, immutable provenance refs, and decision-trail history;
- run event history remains bounded and replay-safe;
- run policy history remains evidence-derived from `step-result` and `delivery-plan` outputs.

## Run-control baseline (module operations)

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
- high-risk controls (`steer`, `cancel`) evaluate `approval_policy` + `risk_tiers` before apply;
- blocked actions still emit durable audit evidence and warning-style live-run events.

Durable audit baseline:
- every control action writes one durable `run-control-event-*.json` record under runtime reports;
- control records include `run_id`, `action`, transition snapshot, guardrail decision, and `evidence_root`.

## Delivery/release baseline (module operations)

Delivery/release payload baseline:
- `run_id` (optional command-scoped run identity; deterministic fallback when omitted);
- `step_class` (optional, defaults to `implement`);
- `mode` (optional override; canonicalized aliases map to `no-write | patch-only | local-branch | fork-first-pr`);
- `approved_handoff_ref` (optional evidence ref required by non-`no-write` preconditions);
- `promotion_evidence_refs` (optional comma/list refs required by non-`no-write` preconditions).

Delivery/release guardrail baseline:
- resolve policy bounds before materializing delivery/release artifacts;
- non-`no-write` flows stay blocked when approved handoff or promotion evidence is missing;
- route governance decisions resolve to `allow|deny|escalate` with explicit reason codes before write-back paths;
- `release prepare` fails fast with explicit precondition blocking reasons and does not bypass delivery-plan guardrails.

Delivery/release response baseline:
- `delivery_plan_file` and `delivery_plan_status` for policy traceability;
- `delivery_governance_decision` for explicit deny/escalate reasoning;
- `delivery_coordination` for multi-repo coordination requirement and evidence status;
- `delivery_rerun_recovery` for explicit rerun run-ref, failed-step, and packet-boundary scope;
- `delivery_manifest_file` and `release_packet_file` as durable evidence outputs;
- `delivery_writeback_result` to distinguish `no-write-confirmed`, `patch-materialized`, `local-branch-committed`, and `fork-pr-planned`.

## Incident/audit baseline (module operations)

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
- freeze/demote platform rollout actions force rollback-safe `hold` (no direct re-enable);
- recertification updates persist transition provenance (`from_status`, `to_status`, run/promotion refs, evidence root);
- recertification output includes explicit platform linkage (`platform_action`, `platform_linkage`, `rollback_required`) plus finance/quality evidence refs and roots.

Audit runs baseline:
- emits run-centric snapshots of packet, step-result, quality, incident, and promotion refs;
- emits `run_audit_records.finance_evidence` with route/wrapper/adapter IDs plus bounded cost/timeout/latency summaries;
- supports optional `run_id` filter and bounded `limit` window;
- response includes `audit_evidence_refs` for downstream handoff and review workflows.

Context lifecycle read baseline (W8-S09):
- run-level read surfaces expose context lifecycle details when context promotions are present;
- context lifecycle view includes promoted context ref/version, immutable provenance refs, and decision trail lineage;
- operator-facing CLI/API read paths make outdated/blocked context promotion outcomes auditable without opening raw artifacts.

## UI lifecycle baseline (module operations)

UI lifecycle payload baseline:
- `run_id` (optional operator context);
- `control_plane` (optional connected-mode reference for future detached transport).

UI lifecycle response baseline:
- `ui_attached` boolean;
- `connection_state` in `connected | disconnected | detached`;
- `idempotent` marker for repeated attach/detach retries;
- `headless_safe=true` to assert CLI/API paths remain usable while UI is detached.

## Streaming baseline

The current live stream is module-backed and uses the same event contract intended for future SSE transport.

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

## Deferred detached HTTP transport (W9-S07)

Detached endpoint paths and SSE wiring are **deferred** to `W9-S07`.
The intended transport mapping (not current runtime behavior) is:
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/packets`
- `GET /api/projects/:projectId/step-results`
- `GET /api/projects/:projectId/quality-artifacts`
- `GET /api/projects/:projectId/runs`
- `GET /api/projects/:projectId/runs/:runId/events/history`
- `GET /api/projects/:projectId/runs/:runId/policy-history`
- `GET /api/projects/:projectId/runs/:runId/events` (SSE + replay parameters).

Until `W9-S07` lands, these endpoint paths are contract targets, not guaranteed runtime endpoints.

## API/UI alignment notes (W5-S04 + W9-S03)

- The detachable web console currently reads run/evidence state via in-process API module operations.
- Live follow in web mode currently reuses the same in-process stream contract and backpressure semantics.
- Detach behavior is UI-local only: detaching unsubscribes the web listener while runtime artifacts stay owned by orchestrator runtime.
- Switching connected mode to detached HTTP/SSE transport is explicitly deferred to `W9-S07`.

## Authentication and permission assumptions
- Baseline assumption for local/operator rehearsals: trusted local operator context behind workspace access controls.
- Read operations are read-only and must not mutate runtime artifacts.
- Production deployments should require authenticated identity with project-scoped read permissions before exposing packet or evidence references.
- Responses should preserve `evidence://` or runtime-relative refs for audit traceability and must not return secrets.

## Key design rules
- keep the control-plane surface usable without the web UI;
- keep ids and references visible in responses;
- expose explicit approval and dry-run paths for risky actions;
- keep operation and query shapes aligned with contract docs and CLI catalog.
