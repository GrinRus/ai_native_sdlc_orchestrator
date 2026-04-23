# Control plane API

## Purpose
Define one control-plane surface for command, query, and live-stream operations while keeping the runtime headless-first.

## Current implementation binding (W9 baseline)

Current code is **hybrid module + detached transport**:
- API surface is exported from `apps/api/src/index.mjs` as function operations for headless/in-process workflows.
- Detached HTTP/SSE transport baseline is implemented in `apps/api/src/http-transport.mjs` for connected web mode.
- Contract and artifact semantics stay aligned across both bindings.

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
- `binding_mode=hybrid-module-and-detached-http-sse`;
- `deferred_transport_status=implemented`.

## Command families
- project bootstrap commands
- intake and planning commands
- approval commands
- run lifecycle commands
- eval and harness commands
- delivery and release commands
- incident and promotion commands

## Query families
- projects
- packets
- runs
- step results
- validation and evaluation reports
- delivery manifests and release packets
- incidents and promotion decisions

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
- `delivery_writeback_result` to distinguish `no-write-confirmed`, `patch-materialized`, `local-branch-committed`, `fork-pr-planned`, and `fork-pr-draft-created`.

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
- `control_plane` (optional connected-mode reference for detached transport routing).

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

## Detached HTTP transport baseline (W10-S03)

Connected-mode transport mapping is implemented for read, follow, and bounded mutation baseline:
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/strategic-snapshot`
- `GET /api/projects/:projectId/packets`
- `GET /api/projects/:projectId/step-results`
- `GET /api/projects/:projectId/quality-artifacts`
- `GET /api/projects/:projectId/delivery-manifests`
- `GET /api/projects/:projectId/promotion-decisions`
- `GET /api/projects/:projectId/runs`
- `GET /api/projects/:projectId/runs/:runId/events/history`
- `GET /api/projects/:projectId/runs/:runId/policy-history`
- `GET /api/projects/:projectId/runs/:runId/events` (SSE + replay parameters).
- `POST /api/projects/:projectId/run-control/actions`
- `POST /api/projects/:projectId/ui-lifecycle/actions`

Detached mutation payload baseline:
- run-control payload fields: `action`, `run_id`, `target_step`, `reason`, `approval_ref`;
- run-control response reuses module parity fields: `state_file`, `audit_file`, guardrail decision, transition, live event ids;
- blocked run-control transitions return `409` with `{ error: { code, message }, run_control }` while still persisting audit and lifecycle artifacts;
- ui lifecycle payload fields: `action`, `run_id`, `control_plane`;
- ui lifecycle response reuses module parity fields: `state_file`, `connection_state`, `headless_safe`, `idempotent`.

Detached mutation error-shape baseline:
- `invalid_json` for malformed request body;
- `invalid_payload` for non-object JSON payload;
- `invalid_run_control_action` and `invalid_ui_lifecycle_action` for unsupported actions;
- `run_control.blocked` family codes for policy or transition blocking branches.

Detached authn/authz baseline (W10-S04):
- auth mode is optional and disabled by default for local trusted operator rehearsals;
- when auth is enabled, requests require `Authorization: Bearer <token>`;
- tokens are project-scoped and permission-scoped (`read` and `mutate`);
- missing or invalid credentials return HTTP `401` with `error.code` in `auth.missing_credentials | auth.invalid_token`;
- project mismatch or missing permission return HTTP `403` with `error.code` in `auth.forbidden_project | auth.insufficient_permission`;
- auth error payload includes `error.auth.required_permission`, `error.auth.project_id`, and `error.auth.token_id` (when available).

Deferred beyond this baseline:
- mutation-command HTTP endpoint parity for the full CLI surface outside the supported run-control and UI lifecycle actions;
- production authn/authz and deployment hardening.

## API/UI alignment notes (W5-S04 + W9-S03 + W10-S03)

- The detachable web console reads run/evidence state through detached HTTP/SSE when `control_plane` is configured and connected.
- Connected-mode web mutation actions for run-control and UI lifecycle route through detached HTTP mutation endpoints.
- Headless/disconnected web operation remains module-backed and in-process.
- Detach behavior is UI-local only: detaching unsubscribes the web listener while runtime artifacts stay owned by orchestrator runtime.
- Connected-mode fallback and headless-safe semantics remain explicit through `ui-lifecycle` state.

## Authentication and permission assumptions
- Baseline assumption for local/operator rehearsals: trusted local operator context behind workspace access controls.
- Detached transport can enable optional bearer-token auth with project-scoped `read` and `mutate` permissions.
- Read operations are read-only and must not mutate runtime artifacts.
- Production deployments should require authenticated identity with project-scoped read permissions before exposing packet or evidence references.
- Responses should preserve `evidence://` or runtime-relative refs for audit traceability and must not return secrets.

## Key design rules
- keep the control-plane surface usable without the web UI;
- keep ids and references visible in responses;
- expose explicit approval and dry-run paths for risky actions;
- keep operation and query shapes aligned with contract docs and CLI catalog.
