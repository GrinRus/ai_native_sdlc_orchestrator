# Control plane API

## Purpose
Define one control-plane surface for command, query, and live-stream operations while keeping the runtime headless-first.

## Current implementation binding (W9 baseline)

Current code is **hybrid module + detached transport**:
- API surface is exported from `apps/api/src/index.mjs` as function operations for headless/in-process workflows.
- Detached HTTP/SSE transport baseline is implemented in `apps/api/src/http-transport.mjs` for connected web mode.
- Contract and artifact semantics stay aligned across both bindings.

Implemented operation families:
- read: project state, packets, step results, manifests, promotion decisions, quality artifacts, runs, run event history, run policy history, strategic snapshot, planner metrics;
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
- review and learning-loop commands
- delivery and release commands
- incident and promotion commands

Project bootstrap baseline:
- `project init` may materialize a clean target repo through public bootstrap flags only;
- `project init` accepts optional repo verification overrides via repeatable `repo_build_command`, `repo_lint_command`, and `repo_test_command` inputs so curated live E2E targets can preserve required setup and verification commands without proof-runner-side profile generation.
- `project verify` accepts `verification_label` plus repeatable `repo_build_command`, `repo_lint_command`, and `repo_test_command` inputs. Labels separate baseline diagnostics, primary post-run gates, and diagnostic full-suite evidence while preserving command source in the verify summary.

## Query families
- projects
- packets
- runs
- step results
- validation and evaluation reports
- review reports, review decisions, and learning-loop closure artifacts
- delivery manifests and release packets
- incidents and promotion decisions
- planner metric snapshots

## Connected lifecycle mutations (W18 baseline)

W18 closes the first connected-web gap between the bounded run-control/UI mutation baseline and a web surface that can drive the approved lifecycle through the control plane. This is a bounded lifecycle subset, not a full CLI-over-HTTP parity claim.

Lifecycle command mutations must:
- cover the minimum bootstrap, intake, discovery, spec, planning, handoff, run, review, delivery, and learning actions needed by the web full-flow path;
- call the same runtime command handlers used by CLI/headless flows instead of adding UI-owned orchestration logic;
- return existing command response fields and durable artifact refs where available;
- preserve policy, approval, validation, and blocked-next-step evidence in stable response shapes;
- support the interactive continuation flow described by `step-result.requested_interaction`;
- include an answer-submission command mutation for unresolved runner-requested interactions before web full-flow claims answer support.

HTTP lifecycle command mutation baseline:
- route: `POST /api/projects/:projectId/lifecycle-command/actions`;
- payload fields: `command` plus optional `flags`;
- `command` must be one of the bounded implemented lifecycle commands documented in `module-surface-baseline.yaml`;
- `flags` is a JSON object whose keys map to CLI flags by replacing `_` with `-`;
- `project_ref`, `project-ref`, `runtime_root`, `runtime-root`, and `help` are server-owned and cannot be supplied by clients;
- the transport injects the scoped project ref and runtime root before invoking the existing CLI/runtime path;
- successful responses return `{ lifecycle_command }` with `command_output` preserving the CLI JSON fields, `artifact_refs`, `evidence_refs`, `exit_code`, `stdout`, `stderr`, and `interactive_continuation`;
- unsupported commands or invalid/missing required flags return HTTP `400` with `error.code` in `invalid_lifecycle_command | invalid_lifecycle_flags`;
- command outputs that report policy, validation, guardrail, or interaction blocking return HTTP `409` with `{ error, lifecycle_command }` while preserving any durable output refs the runtime produced.

HTTP interactive answer mutation baseline:
- route: `POST /api/projects/:projectId/interactions/answers`;
- payload fields: `run_id`, `interaction_id`, `answer`, and optional `reason`, `approval_ref`, `answer_evidence_ref`;
- the referenced interaction must match the latest unresolved run-linked `step-result.requested_interaction`;
- accepted answers write one durable `interaction-answer-*.json` audit artifact under the runtime reports root before any continuation state changes;
- response payloads return `{ interaction_answer }` with `interaction_id`, `interaction_status`, `answer_audit_ref`, `step_result_ref`, `run_control_transition`, `blocked_reason`, and live event ids;
- when the current runtime cannot resume from the recorded interaction boundary, the transport returns HTTP `409` with `error.code=interaction.continuation_blocked` and keeps the run blocked with evidence refs;
- live events and query payloads must reference `answer_audit_ref` and must not include the raw answer text.

## Read surface baseline (module operations)

Read operations must reuse existing contract families and IDs rather than introducing API-only parallel shapes.

Run-level read baseline:
- run summaries include `context_lifecycle` when run-linked promotion decisions reference context assets, with context version refs, immutable provenance refs, and decision-trail history;
- run event history remains bounded and replay-safe;
- run policy history remains evidence-derived from `step-result` and `delivery-plan` outputs.
- `strategic_snapshot.planner_metrics` and `GET /api/projects/:projectId/planner-metrics` expose one `planner-metrics-snapshot` read model with `clean_close_rate`, `retry_rate`, `repair_rate`, and `blocker_rate`.
- Empty projects must return `status=no-data`, `no_data=true`, and `value=null` per metric rather than claiming a zero success or failure rate.
- Planner metrics derive only from durable run, review, Runtime Harness, incident, and run-control audit artifacts; they do not mutate scheduler state.

## Run-control baseline (module operations)

Command payload baseline:
- `reason` (optional text summary for operator intent);
- `target_step` (optional for `start`, required for `steer`);
- `require_validation_pass` (optional start-only boolean, defaults to true for public execution runs);
- `approved_handoff_ref` (optional start-only evidence ref for bounded execution provenance);
- `promotion_evidence_refs` (optional start-only evidence refs for delivery/release-safe execution start);
- `approval_ref` (required by high-risk policy guardrails when applicable).

Deterministic transition baseline:
- `start` creates/opens `running` lifecycle and may finalize to `completed|failed` in the same invocation when one routed execution attempt finishes inline;
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

Full-journey execution baseline (W13):
- `run start` is the canonical public execution entrypoint for full-journey live runs;
- successful execution emits one run-linked `step-result` plus terminal `live-run-event` lineage;
- `run status` resolves that execution lineage without requiring harness-private execution state.
- `project verify` and `run start` both accept `route_overrides` and `policy_overrides` so live E2E can apply provider-pinned matrix-cell routing deterministically through the public CLI surface.
- Full-journey live E2E may continue after a degraded `run start` only when public routed step, Runtime Harness, and adapter raw evidence were materialized. Missing execution evidence remains a hard blocker.

Interactive continuation target (W18-S01):
- when a routed step requests operator input, the run should preserve a query-safe `requested_interaction` payload in the run-linked step result;
- operator answers should be submitted through a control-plane command path that records answer audit evidence before any continuation attempt;
- answer submission payloads should include `run_id`, `interaction_id`, `answer`, and optional `reason`, `approval_ref`, or `answer_evidence_ref`;
- answer submission responses should include `interaction_id`, `interaction_status`, `answer_audit_ref`, `step_result_ref`, `run_control_transition`, and `blocked_reason` when continuation cannot proceed;
- continuation should either resume the bounded run from the recorded interaction boundary or remain blocked with explicit evidence refs and reason codes;
- live event payloads should reference `requested_interaction` and `answer_audit_ref` without exposing raw answer text;
- web clients may present and submit the interaction, but the control plane remains responsible for validation, audit, and run-state transitions.

Answer validation baseline for W18:
- the referenced `interaction_id` must match the latest unresolved run-linked `requested_interaction`;
- empty answers are invalid unless an `answer_evidence_ref` points to a durable operator-provided artifact;
- accepted answers must write one durable audit artifact before the run attempts to continue;
- rejected answers must return a stable blocked/error shape and preserve the prior interaction evidence.

## Delivery/release baseline (module operations)

Delivery/release payload baseline:
- `run_id` (optional command-scoped run identity; deterministic fallback when omitted);
- `step_class` (optional, defaults to `implement`);
- `mode` (optional override; must be one of `no-write | patch-only | local-branch | fork-first-pr`);
- `quality_gate_mode` (optional for `deliver prepare`, defaults to `strict`; `release prepare` always uses strict semantics);
- `approved_handoff_ref` (optional evidence ref required by non-`no-write` preconditions);
- `promotion_evidence_refs` (optional comma/list refs required by non-`no-write` preconditions).
- `coordination_evidence_refs`, `rerun_of_run_id`, `rerun_failed_step`, and `rerun_packet_boundary` preserve multi-repo and rerun recovery evidence.
- `route_overrides` and `policy_overrides` apply provider-pinned delivery/release routing deterministically through the public CLI surface.
- `ticket_id`, `branch_name`, `commit_message`, `fork_owner`, `fork_remote_url`, `base_ref`, `pr_title`, and `pr_body` describe planned write-back metadata.
- `network_write` is explicit and defaults to false; fork-first remote writes remain blocked unless policy and operator inputs allow them.

Delivery/release guardrail baseline:
- resolve policy bounds before materializing delivery/release artifacts;
- non-`no-write` flows stay blocked when approved handoff or promotion evidence is missing;
- route governance decisions resolve to `allow|deny|escalate` with explicit reason codes before write-back paths;
- `release prepare` fails fast with explicit precondition blocking reasons and does not bypass delivery-plan guardrails.

Delivery/release response baseline:
- `delivery_plan_file` and `delivery_plan_status` for policy traceability;
- `delivery_quality_gate_mode`, `delivery_quality_gate_status`, and `delivery_quality_gate_findings` for strict/observe gate evidence when the command exposes observe mode;
- `delivery_governance_decision` for explicit deny/escalate reasoning;
- `delivery_coordination` for multi-repo coordination requirement and evidence status;
- `multirepo_coordination` for scoped lock and cross-repo validation status reads;
- `delivery_rerun_recovery` for explicit rerun run-ref, failed-step, and packet-boundary scope;
- `delivery_manifest_file` and `release_packet_file` as durable evidence outputs;
- `runtime_harness_report_file` and `runtime_harness_overall_decision` for the latest Runtime Harness gate used by strict delivery/release checks;
- `delivery_writeback_result` to distinguish `no-write-confirmed`, `patch-materialized`, `local-branch-committed`, `fork-pr-planned`, and `fork-pr-draft-created`.

## Incident/audit baseline (module operations)

Incident open payload baseline:
- `run_id` (required run linkage for the incident lifecycle);
- `summary` (required operator summary);
- `severity` (optional level, defaults to `high`);
- `status` (optional state, defaults to `open`);
- `linked_asset_refs` (optional explicit evidence refs).

Incident open response baseline:
- durable `incident_report_file` path for one contract-valid `incident-report`;
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
- emits `run_audit_records.provider_execution_status` from materialized adapter raw execution evidence, not from provider route traceability alone;
- supports optional `run_id` filter and bounded `limit` window;
- response includes `audit_evidence_refs` for downstream handoff and review workflows.

## Review and learning baseline (module operations)

Review run baseline:
- `review run` is report-only and must not block subsequent commands by exit code alone when verdict is `warn|fail`;
- response includes `review_report_file`, `review_overall_status`, and `review_recommendation`;
- `review-report` must cover `feature_traceability`, `discovery_quality`, `artifact_quality`, `code_quality`, `feature_size_fit`, `provider_traceability`, `findings`, and `evidence_refs`;
- artifact review must treat bootstrap-owned files and runner-produced request-input files as non-code when computing target code-scope findings.

Review decision baseline:
- `review decide` writes one durable `review-decision` artifact for `approve`, `hold`, or `request-repair`;
- `approve` must be blocked unless linked `review-report` and Runtime Harness evidence both pass;
- delivery/release commands may require this approval through `require_review_decision` lifecycle flags that map to `--require-review-decision`.

Learning handoff baseline:
- `learning handoff` writes one public `learning-loop-scorecard` and one public `learning-loop-handoff`;
- existing public `incident-report` linkage is preserved instead of replaced when incident open/recertify already ran;
- closure artifacts are derived from public run, review, eval, audit, and incident evidence, not from harness-private observability shortcuts;
- closure artifacts preserve matrix-cell and coverage-follow-up metadata so the next required live E2E cell remains machine-readable.

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
- `GET /api/projects/:projectId/planner-metrics`
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
- `POST /api/projects/:projectId/lifecycle-command/actions`
- `POST /api/projects/:projectId/interactions/answers`

Detached mutation payload baseline:
- run-control payload fields: `action`, `run_id`, `target_step`, `reason`, `approval_ref`;
- run-control response reuses module parity fields: `state_file`, `audit_file`, guardrail decision, transition, live event ids;
- blocked run-control transitions return `409` with `{ error: { code, message }, run_control }` while still persisting audit and lifecycle artifacts;
- ui lifecycle payload fields: `action`, `run_id`, `control_plane`;
- ui lifecycle response reuses module parity fields: `state_file`, `connection_state`, `headless_safe`, `idempotent`.
- lifecycle-command payload fields: `command`, `flags`;
- lifecycle-command response reuses CLI command output fields under `command_output` and adds transport-level `artifact_refs`, `evidence_refs`, `blocked`, and `blocked_reason`;
- interaction answer payload fields: `run_id`, `interaction_id`, `answer`, `reason`, `approval_ref`, `answer_evidence_ref`;
- interaction answer response writes and references durable answer audit evidence before reporting whether continuation remains blocked.

Detached mutation error-shape baseline:
- `invalid_json` for malformed request body;
- `invalid_payload` for non-object JSON payload;
- `invalid_run_control_action`, `invalid_ui_lifecycle_action`, and `invalid_lifecycle_command` for unsupported actions;
- `invalid_lifecycle_flags` and `interaction_answer.invalid_answer` for malformed mutation inputs;
- `run_control.blocked` family codes for policy or transition blocking branches.
- `lifecycle_command.blocked`, `lifecycle_command.interaction_required`, and `interaction.continuation_blocked` for bounded command and continuation blocking branches.

Detached authn/authz baseline (W10-S04):
- auth mode is optional and disabled by default for local trusted operator rehearsals;
- when auth is enabled, requests require `Authorization: Bearer <token>`;
- tokens are project-scoped and permission-scoped (`read` and `mutate`);
- missing or invalid credentials return HTTP `401` with `error.code` in `auth.missing_credentials | auth.invalid_token`;
- project mismatch or missing permission return HTTP `403` with `error.code` in `auth.forbidden_project | auth.insufficient_permission`;
- auth error payload includes `error.auth.required_permission`, `error.auth.project_id`, and `error.auth.token_id` (when available).

Deferred beyond this baseline:
- mutation-command HTTP endpoint parity for commands outside the supported W18 lifecycle subset;
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
- expose verdict and closure artifacts through public module surfaces before relying on proof-runner-side aggregation;
- keep operation and query shapes aligned with contract docs and CLI catalog.
