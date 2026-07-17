# Control plane API

## Purpose
Define one control-plane surface for command, query, and live-stream operations while keeping the runtime headless-first.

The application service in `packages/orchestrator-core` is the single implementation boundary. `apps/api`, the CLI, and the local app launcher are transport facades with explicit exports; transports must not import one another.

The command catalog exposes structural `flags[]` and `positionals[]` metadata (`type`, `required`, `repeatable`, optional `enum`, and optional `default`). CLI and lifecycle HTTP validation reject unknown flags and repeated non-repeatable flags before invoking a handler.

Project topology is controlled through the same application-service boundary from
CLI and HTTP. `GET /api/projects/:projectId/topology` returns the portable
repositories, components, dependency graph, machine-local binding summaries,
registry revision, and latest deterministic validation. `POST
/api/projects/:projectId/topology/actions` accepts a typed family/action/value
request with optional `expected_revision`; stale revisions, unknown references,
blocking validation, and active-flow conflicts fail before publication. `GET
/api/projects/:projectId/topology/validation` returns the latest stored validation
without initializing project runtime state. The compatibility
`POST /api/projects/actions` add action remains workspace-scoped.

Execution setup uses the same boundary. `GET
/api/projects/:projectId/execution-profile` derives approved route, adapter,
provider, requested/effective model, capability, fallback, revision, and latest
readiness state from `project-profile.default_route_profiles`; it does not
initialize runtime state. `POST
/api/projects/:projectId/execution-profile/actions` accepts only `select`,
`reset`, or `check`. Select/reset mutate the portable project profile under
revision and active-run guards. Check writes a credential-free readiness
summary to the Local Workspace registry and never spawns a provider.

All operator failures use one `OperatorError`: `code`, `title`, `detail`, the compatibility alias `message`, operation/phase/resource/consequence/retryability, scoped refs, field errors, evidence refs, and typed recovery actions. Recovery identifiers come only from the canonical catalog and are never inferred from provider text, stack traces, or shell commands.

Control-plane collection limits are centralized: list responses default to 200 and cap at 1000; SSE replay defaults to 0 and caps at 1000.

## Current implementation binding (W9 baseline)

Current code is **hybrid module + detached transport**:
- API surface is exported from `apps/api/src/index.mjs` as function operations for headless/in-process workflows.
- Detached HTTP/SSE transport baseline is implemented in `packages/orchestrator-core/src/control-plane/http/**`; `apps/api/src/http-*.mjs` files are explicit compatibility facades.
- CLI/API lifecycle behavior is owned by shared package services under `packages/orchestrator-core/src/operator-cli/**` and `packages/orchestrator-core/src/control-plane/**`; app-level API and CLI modules are transports/wrappers and must not import each other.
- Contract and artifact semantics stay aligned across both bindings.

ADR `docs/architecture/adr/0002-alpha-hybrid-api-transport.md` records this as
the accepted alpha transport boundary. A future NestJS-backed transport requires
a new ADR before implementation work changes this contract.

Implemented operation families:
- read: local app project index, project topology, execution profile, project state, packets, step results, manifests, promotion decisions, compiler revision statuses, quality artifacts, runs, run event history, run policy history, strategic snapshot, planner metrics, finance monitoring, next-action report, flow projections;
- run control: start/pause/resume/steer/cancel with guardrail enforcement and audit records;
- operator requests: create/list/run bounded operator-initiated runtime interventions with sanitized read payloads;
- UI lifecycle: attach/detach/read state with headless-safe semantics;
- live events: append/read/open stream using the `live-run-event` contract family.

## Machine-checkable baseline (W9-S04)

The `control-plane-api` family is loader-covered with a machine-checkable baseline example:
- `examples/control-plane-api/module-surface-baseline.yaml`

W30 adds a machine-readable detached transport contract:
- `docs/contracts/control-plane-api.openapi.json`

The OpenAPI 3.1 artifact is the route-level contract for the implemented
detached HTTP/SSE surface. `pnpm production:ready` validates that each router
route has a matching OpenAPI path, method, route id, permission, and route kind.
This drift check covers the current alpha transport only; it is not a hosted
SaaS API claim and does not imply full CLI-over-HTTP parity.
The current schema depth is intentionally local-alpha scoped: project state,
run summaries, bounded run event history, run-control mutations, lifecycle
command mutations, UI lifecycle mutations, and interaction answer mutations have
concrete request/response component schemas, while broad packet/report artifact
lists continue to reference their owning contract families.

Required top-level fields in the loader baseline:
- `api_id`, `version`, `binding_mode`, `deferred_transport_status`;
- `read_operations`, `run_control_operations`, `ui_lifecycle_operations`, `live_event_operations`;
- `deferred_transport`.

Current enum constraints:
- `binding_mode=hybrid-module-and-detached-http-sse`;
- `deferred_transport_status=implemented`.

## Production hardening boundary (W20-S02)

The detached HTTP/SSE transport now has two explicit security modes:
- `local-trusted` is the default for loopback development and local harness use. It may run without bearer credentials, but it still uses the same route permission metadata and redaction helpers.
- `production-hardened` requires bearer authentication for every read, stream, and mutation route. This mode is a transport hardening baseline, not an enterprise identity-provider integration or hosted SaaS claim.

The packaged browser application is a separate loopback-only same-origin
topology. It does not make the detached API a hosted-web backend, may not attach
to an arbitrary remote control plane, and may not persist AOR bearer tokens in
browser storage. The detached production-hardened API remains fully usable
without the SPA. Hosted browser authentication, SSO, TLS termination, tenant
security, and public cross-origin access require a future ADR and contract.

`local-trusted` listeners accept only the literal bind addresses `127.0.0.1`
and `::1`; names such as `localhost`, wildcard/LAN addresses, and IPv4-mapped
IPv6 addresses fail before `listen` or runtime materialization. After bind the
transport derives one canonical authority (`127.0.0.1:<port>` or
`[::1]:<port>`), rejects every other `Host`, and requires browser mutations to
carry that exact `Origin`. Requests without `Origin` remain available to trusted
same-account CLI/curl clients only when browser fetch metadata is absent.

Every mutation requires `application/json` or `application/*+json`, is limited
to 1 MiB by both declared and incremental byte counts, and must finish body
delivery within five seconds. Rejections return `415`, `413`, or `408` before a
domain mutation runs. Same-origin responses and `/app-config.json` use the
shared redaction policy and `Cache-Control: no-store`; app config contains only
listener metadata and minimal project identities, not absolute project paths.

While the July 2026 trust-boundary audit hold is open, lifecycle mutation bodies
may carry `unsafe_development_override: true`. The shared runtime accepts it only
as an explicit, auditable development override for external write-capable live
execution or credentialed network delivery. Omission and `false` are equivalent
and fail closed for those operations. Dry-run, mock, contract,
repository-integrity, and external `no-write` paths do not require the override.
The field is not release clearance and transport wrappers may not synthesize it.

Auth and authorization behavior:
- bearer principals are configured out-of-band when the detached transport starts;
- each principal carries `read` and/or `mutate` permission scopes plus allowed `project_refs`;
- in `production-hardened` mode, permission scopes must be declared explicitly as a non-empty array with at least one supported scope; tokens with missing, empty, or unknown-only `permissions` authenticate as configured principals but fail authorization with `auth.insufficient_permission` for every route because no implicit production scope is granted;
- in `local-trusted` mode, tokens that omit `permissions` keep the legacy local development default of `read+mutate` so existing loopback smoke paths remain compatible;
- all route definitions declare one required permission before handlers run;
- missing, invalid, wrong-project, and insufficient-scope decisions return stable `auth.*` error codes with `required_permission`, `project_id`, `token_id`, and `security_mode`;
- denied transport actions do not invoke mutation handlers.

Secret-safe payload behavior:
- configured bearer token values and additional configured redaction values are redacted from JSON responses and SSE events;
- live-run event writes redact sensitive fields before appending JSONL logs;
- run-control audit records redact configured secret values while preserving denial reasons and policy context;
- CLI JSON output applies the same redaction primitive to configured local secret values from `AOR_REDACTION_SECRETS`;
- durable audit evidence may retain non-secret operator intent, approval refs, state refs, and evidence refs for reviewability.

Out of scope for this baseline:
- external identity-provider federation;
- hosted tenant isolation;
- broad SaaS audit retention policy;
- replacing repository/provider permissions with AOR transport auth.

## Command families
- project bootstrap commands
- intake and planning commands
- approval commands
- run lifecycle commands
- eval and harness commands
- review and learning-loop commands
- delivery and release commands
- incident and promotion commands

## Guided installed-user boundary (W21-S01)
Guided UX surfaces use the installed-user journey defined in `docs/product/02-installed-user-onboarding-journey.md`.

The control plane remains the orchestration owner:
- `doctor`, `onboard`, `mission create`, `next`, and `app` are guided vocabulary over existing command/query families;
- web stages read the same project, packet, run, quality, finance, and lifecycle state exposed by the control plane;
- guided mutations must call runtime command handlers or existing control-plane mutation families;
- guided web can invoke the bounded `mission create` and `next` lifecycle-command mutations to create mission evidence and refresh the durable `next-action-report`;
- guided web can invoke operator-request mutations to analyze, explain, revise, repair, validate, plan, implement, or review bounded artifacts from any stage while keeping raw request text in durable evidence only;
- the installed local SPA is served by `aor app` from the shared HTTP transport, not by importing `apps/api` into the CLI launcher;
- the installed local SPA can switch between explicitly registered local projects through app-session project summaries, but each selected project keeps separate runtime state, flow projections, evidence refs, and mutation routes;
- CLI/app/API ingress creates one immutable selected-project context containing
  the runtime project id, canonical project root, runtime root, project runtime
  root, canonical profile path, and registry identity. Downstream compatibility
  options are derived from that context with `cwd` pinned to the canonical
  project root; launcher cwd is never an internal fallback.
- project-, runtime-, evidence-, and repository-relative references use an
  explicit context base and reject absolute, traversal, empty-segment,
  backslash, and existing-symlink escapes. Read-only context creation and
  project selection never materialize runtime state.
- read-only, disconnected, connected, detached, blocked, and ready UI states must be derived from durable runtime state;
- guided flows must preserve no-upstream-write defaults until delivery mode, policy, review, approval, and writeback evidence are explicit.

Project bootstrap baseline:
- `project init` may materialize a clean target repo through public bootstrap flags only;
- `project init` accepts optional repo verification overrides via repeatable `repo_build_command`, `repo_lint_command`, and `repo_test_command` inputs so curated target profiles can preserve required setup and verification commands without private profile generation. Materialized profiles expose those commands through generic `verification.command_groups[]` while keeping legacy per-repo command lists for compatibility.
- `project verify` accepts `verification_label` plus repeatable `repo_build_command`, `repo_lint_command`, and `repo_test_command` inputs. Labels separate baseline diagnostics, primary post-run gates, and diagnostic full-suite evidence while preserving command source in the verify summary. Legacy command inputs are normalized into generic command groups before execution.
- `project verify --plan` writes `verification-plan.json` or `verification-plan-<label>.json` under the runtime reports root without executing target commands. CLI JSON returns `verification_plan_file`, `verification_plan`, generated command groups, discovery candidates, confidence, and source refs.
- `project verify` summaries include per-group `role`, `phase`, `enforcement`, `timeout_class`, status, and step-result refs. `required` failures fail the verify summary, `warn` failures produce warning evidence, and `observe` failures remain non-blocking evidence.
- `GET /api/projects/:projectId/state` exposes `verification_plan` when a plan or verify summary exists. The read model includes per-group role, phase, enforcement, timeout class, working directory, status, last result status, outcome, failed command count, failed step-result refs, blocked next step, and step-result refs so the web console can distinguish failed, warn, observed, skipped, and not-applicable groups without reading private process state.
- `project verify` enforces a bounded per-command timeout derived from the project profile and records command evidence through `command_timeout_ms`, `timed_out`, `started_at`, `finished_at`, `duration_ms`, `exit_code`, `signal`, `error_code`, bounded output excerpts, transcripts, and `timed_out_commands`.
- `project verify` treats high-signal warning output in stderr as a failed command even when the process exits 0. Step results record bounded `output_quality_findings[]`, and verify summaries aggregate `output_quality_failed_commands[]` plus the active `output_quality_warning_patterns[]`.
- `project verify` accepts repeatable `output_quality_baseline` inputs that point to previous verify summaries. Matching warning classes remain in `output_quality_findings[]` with `baseline_status=pre_existing` and are aggregated under `output_quality_baseline_matches[]`, but only non-baseline warning findings fail the current verify. Matching failed baseline commands are reported through `baseline_failure_status=pre_existing` on the current step-result and aggregated under `verification_failure_baseline_matches[]`, allowing read models to separate broken-baseline evidence from new post-change regressions.
- `project verify` disables inherited Node compile-cache state for target commands so AOR runtime/session caches cannot contaminate package-manager, lint, test, or build execution in target checkouts.
- Run summaries include source metadata (`commit_sha`, `branch_name`) so qualification accounting can reject stale or cross-branch evidence before counting a run.

## Query families
- projects
- packets
- flow projections
- runs
- step results
- validation and evaluation reports
- review reports, review decisions, and learning-loop closure artifacts
- delivery manifests and release packets
- incidents and promotion decisions
- compiler revision status reports
- planner metric snapshots
- finance monitoring snapshots
- next-action reports

## Flow projection baseline (W34-S02)

W34 adds implemented flow-centric read models over existing runtime artifacts
without making the browser an orchestration owner.

Flow projections are additive read models over existing durable artifacts:
- `flow_id` is stable for one mission/intake lineage.
- `status` is `active` for mutable in-progress flows or `completed` for
  read-only evidence chains.
- `selected_stage` is derived from the latest `next-action-report` and closure
  artifacts.
- `mission_id`, `intake_packet_ref`, and `intake_body_ref` point to existing
  mission evidence.
- `latest_next_action_report_ref` points to the report that selected the next
  action or closure state.
- `evidence_refs[]` contains only refs belonging to the selected flow.
- `writeback_policy` mirrors mission scope and delivery evidence, including
  `upstream_writes_default=false` for installed-user guided flows.
- `mission_settings` provides duplicate-safe mission intake defaults for
  follow-up flow creation; submitting them still creates a new intake packet.
- `closure_state` exposes completed-flow status, follow-up eligibility,
  source run id, and learning handoff refs for closure-to-new-flow UX.
- `completed_read_only=true` is required for completed flows.
- `follow_up_source_handoff_ref` may cite a learning handoff from a completed
  source flow when a new follow-up flow is created.

Implemented detached read routes:
- `GET /api/projects/:projectId/flows` returns the bounded flow list with
  `selected_flow_id`, `active_flow_ids`, `completed_flow_ids`, and flow
  projections.
- `GET /api/projects/:projectId/flows/selected` returns the selected flow
  projection or `null`.
- `GET /api/projects/:projectId/flows/:flowId` returns one flow projection or
  `404`.
- `GET /api/projects/:projectId/flows/:flowId/evidence-graph` returns a
  selected-flow-only evidence graph. Nodes and edges are built only from the
  flow projection `evidence_refs[]` and sanitized operator requests whose
  `target_flow_id` matches the selected flow.
- `GET /api/projects/:projectId/flows/:flowId/runtime-trace` returns a
  selected-flow-only trace that links live run events, step results, Runtime
  Harness decisions, delivery manifests, release packets, learning artifacts,
  and operator requests that belong to the selected flow.

Flow list and detail reads must be deterministic and must not create artifacts.
`New Flow` is a lifecycle action through `mission create` plus `next`; it
creates fresh mission/intake evidence, refreshes `next-action-report`, and
archives mission-specific next-action evidence so a completed source flow remains
inspectable. Follow-up creation passes
`--follow-up-source-handoff-ref <ref>` through the lifecycle command mutation and
records the lineage on the new intake body/projection. Operator-request
create/read payloads may include `target_flow_id` so Ask AOR can stay scoped to
the selected flow. Mutations against completed flows are blocked with
`operator_request.completed_flow_read_only` unless the request is a
`delivery_mode=no-write` read-only inspection intent.

Flow evidence graph and runtime trace reads are sanitized read models. They must
not include raw `operator-request.request_text`; summaries, refs, target flow,
stage, intent, delivery mode, allowed paths, run ids, and evidence refs remain
queryable.

## Provider step status heartbeat (W35-S01)

Long-running external provider execution is exposed through the query-safe
`provider_step_status` read model. It is additive on:
- `GET /api/projects/:projectId/state` as the latest provider heartbeat across
  local run-control state files;
- `GET /api/projects/:projectId/runs` as each run summary's current provider
  heartbeat.

`provider_step_status` preserves:
- `provider`, `adapter`, `route_id`, `step_id`;
- `status`:
  `starting`, `running`, `silent-running`, `artifact-updated`,
  `timeout-risk`, `completed`, `interrupted`, or `failed`;
- `elapsed_ms`, `timeout_budget_ms`, `remaining_budget_ms`;
- `last_output_at`, `last_artifact_update_at`;
- optional stream progress fields: `last_progress_at`, `last_progress_kind`,
  `last_progress_label`, `progress_event_count`, and `output_mode`;
- `current_command_label`;
- `recommended_action`;
- `started_at`, `updated_at`, and optional `finished_at`.

The field is a public control-plane signal, not process inspection. Runtime code
updates it before and during external adapter execution, and read surfaces
normalize elapsed and timeout budget values when queried. User-facing payloads
must keep `current_command_label` compact and must not expose raw process
commands, command args, prompt text, file contents, environment variables,
bearer tokens, auth tokens, or provider secrets. Stream progress labels must be
sanitized summaries such as `api_response`, `tool_call:read_file`, or
`assistant message`, not raw provider payloads. Raw provider evidence remains
available only through explicit debug/evidence refs.

Active provider heartbeat surfacing extends the same public model to
`GET /api/projects/:projectId/runs/:runId/events/history` and the matching
SSE stream. Provider heartbeat events may include additive
`provider_step_status` snapshots so web/CLI operators can see active
elapsed/budget/progress state without rereading private process state. These
event snapshots follow the same redaction and normalization rules as project
state and run summaries; raw commands, args, prompts, file contents, and secrets
remain out of the event payload.

## External run-health projection (W35-S06)

When a project is opened from an external runner target checkout, the
controller may write public observation and run-health artifacts in the parent
external runner project runtime rather than inside the target checkout `.aor`
tree. The control-plane read surface exposes a compact, query-safe
`run_health` projection so the web console and CLI/API consumers do not show
completed provider execution as delivery-ready while the declared external
flow is blocked.

`run_health` is additive on:
- `GET /api/projects/:projectId/state` as the latest external run-health
  projection visible from the selected project runtime;
- `GET /api/projects/:projectId/runs` as the run summary projection whose
  `run_id` matches the external run-health report.

The projection may include:
- `run_id`, `profile_id`, `status`, `report_status`, `generated_at`;
- `current_step`, `blocked_step_id`, `pending_steps`, and `completed_steps`;
- `missing_operator_decision_steps[]` and `missing_evidence_refs[]`;
- `failure_summary` with `owner`, `phase`, `class`, and `summary`;
- `pending_decision` with action, reason, next step, decision-request ref,
  expected decision ref, and materialized operator-decision ref/status when a
  decision file already exists;
- compact `controller_health` and `resume_interaction_health` fields;
- `blockers[]` suitable for operator-facing next-action/readiness surfaces;
- `artifact_display_summaries[]` for the run-health, observation, and linked
  operator-decision request refs, including closed requests that remain needed
  to explain a blocked external-run state.

Open operator-decision request summaries may include additive
`decision_rubric_summary` metadata with required-check counts, required
evidence-ref counts, short required-check labels, and short evidence-ref labels
plus copyable refs. This summary must stay query-safe: it may expose evidence
refs and operator-facing rubric labels, but not raw provider prompts, command
args, file contents, secrets, auth material, or private operator identity.

This projection is a read model over public runner artifacts only. It must not
read private process state, raw provider prompts, command args, file contents,
environment variables, bearer tokens, auth tokens, or provider secrets. It does
not judge product outcome quality; final code, artifact, accessibility, UI, or
UX quality remains owned by the external quality-assessment report family.

## Execution evidence summaries (W35-S04)

Run summaries expose additive `execution_evidence` for operator-facing
debugging without terminal/process inspection. The field is returned by
`GET /api/projects/:projectId/runs` and is derived only from public runtime
artifacts, run-control state, Runtime Harness reports, review reports, delivery
manifests, and provider heartbeat state.

`execution_evidence` includes:
- `status`, `provider_execution_status`, `runtime_harness_decision`,
  `real_code_change_status`, `post_run_verification_status`, `review_status`,
  `delivery_readiness_status`, and `no_upstream_write_status`;
- `provider_interruption_owner`, `provider_interruption_status`, and
  `provider_interruption_reason` when the visible provider status is
  interrupted;
- `changed_path_groups[]` with `mission-relevant`, `runtime-owned`,
  `runner-owned-leak`, and `scratch-unrelated` grouping;
- `blockers[]` with readable reasons for fail-closed operator handling;
- `actions[]` for public continuation surfaces only.

Scratch-only output must stay visible as `scratch-unrelated` and must not make
`real_code_change_status` pass. Runner-owned state under `.qwen/`, `.codex/`,
`.claude/`, or `.opencode/` inside the target checkout is surfaced as
`runner-owned-leak` with critical severity and blocks delivery proof. Runtime
files such as `.aor/` and `project.aor.yaml` are grouped as `runtime-owned` so
operators do not mistake runtime evidence for target implementation changes.

Execution actions are descriptive public surfaces, not private process control:
- `stop_provider` maps to `aor run cancel`;
- `save_partial_evidence` maps to `aor run status --json`;
- `diagnose_current_step` maps to `aor run status --json`;
- `retry_public_step` maps to `aor run steer --target-step <step_class>`.

Stopping a running provider must write durable interrupted/operator-stopped
evidence in run-control audit/state. Public provider status must include
`interruption_owner=operator`, `interruption_status=operator-stopped`, and a
sanitized reason, and run summaries must classify the failure context as
`failure_owner=operator` with `failure_phase=provider_execution`. The
interrupted run is not a pass and must preserve partial evidence for diagnosis
or retry through public run-control surfaces.

## Artifact display summaries (W35-S02)

Artifact refs remain canonical evidence identifiers, but UI and operator-report
surfaces must not use long filesystem paths or packet/evidence URIs as the
primary visible label. The control plane exposes additive
`artifact_display_summaries[]` arrays on project state, run summaries, and flow
projections, and per-artifact read entries include a `display_summary`.

Each artifact display summary includes:
- `type`, such as `command-trace`, `step-observation`,
  `runtime-harness-report`, `routed-step-result`, `provider-raw-evidence`,
  `verification`, `target-diff`, `delivery-manifest`, `release-packet`, or
  `learning-handoff`;
- `stage`, such as `mission`, `planning`, `execution`, `runtime-harness`,
  `verification`, `review`, `delivery`, or `learning`;
- `label`, `status`, `severity`, `description`, and optional `timestamp`;
- `source_ref` and `raw_ref` for audit/debug use;
- `actions[]`, including `copy_raw_ref` for explicit debug copying.

Artifact summaries may include type-specific additive metadata. For open
operator-decision request summaries, `decision_rubric_summary` lets web and
CLI/API consumers explain which evidence should be inspected before accepting,
diagnosing, blocking, retrying, or answering a decision request.

Missing or unreadable refs are represented as summaries with
`status=missing` and `severity=critical` rather than disappearing from the
read model. Existing step-observation artifacts that are waiting for
operator decision evidence use `status=awaiting-decision` and
`severity=warning`; they must not be rendered as missing evidence. Web renderers
group summaries by flow/stage and may filter them by `Failed`, `Warnings`,
`Provider`, `Runtime Harness`, `Verification`, `Diff`, `Delivery`, and
`Learning`. Raw refs stay available for skill-agent evidence and debugging, but
the user-facing primary text is the summary label/type.

## Structured plan routes (W60)

Flow-scoped structured planning is headless-first and uses the same core
services as the CLI:

- `GET /api/projects/:projectId/flows/:flowId/plan` returns the latest
  structured `wave-ticket`, exact `plan_ref`, and linked handoff without
  materializing artifacts;
- `GET /api/projects/:projectId/flows/:flowId/plan/progress` returns the
  existing immutable `execution-plan` and evidence-derived
  `task-progress-report`, also without materialization;
- `POST /api/projects/:projectId/flows/:flowId/plan/actions` accepts
  `create`, `request_revision`, or `approve`.

`create` and `request_revision` return HTTP `202` plus a planning-run ref.
`approve` returns HTTP `200`, binds the exact plan version/digest, and returns
the materialized execution plan and initial progress. Incomplete, stale,
immutable, unapproved, superseded, or flow-mismatched versions return HTTP
`409` with stable blocker codes. Missing projects/flows/plans return `404`.
Auth uses the existing project-scoped `read`/`mutate` permissions.

Create performs deterministic completeness validation before semantic
evaluation. Semantic warnings are advisory unless the project profile declares
`structured_plan_policy.semantic_evaluator_blocking=true`. The browser Plan
workbench is a consumer of these routes; it is not an orchestration owner.

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
- the transport injects the scoped project ref and runtime root before invoking the shared operator lifecycle service;
- successful responses return `{ lifecycle_command }` with `command_output` preserving the CLI JSON fields, `artifact_refs`, `evidence_refs`, `exit_code`, `stdout`, `stderr`, and `interactive_continuation`;
- `mission create` and `next` are included in the bounded mutation subset for guided web progress; `next` is treated as a mutation because it materializes a durable `next-action-report`;
- unsupported commands or invalid/missing required flags return HTTP `400` with `error.code` in `invalid_lifecycle_command | invalid_lifecycle_flags`;
- command outputs that report policy, validation, guardrail, or interaction blocking return HTTP `409` with `{ error, lifecycle_command }` while preserving any durable output refs the runtime produced.

HTTP interactive answer mutation baseline:
- route: `POST /api/projects/:projectId/interactions/answers`;
- payload fields: `run_id`, `interaction_id`, optional `answer`, optional structured `decision` (`approve_once|deny|approve_for_run`), and optional `reason`, `approval_ref`, `answer_evidence_ref`;
- the referenced interaction must match the latest unresolved run-linked `step-result.requested_interaction`;
- accepted answers write one durable `interaction-answer-*.json` audit artifact under the runtime reports root before any continuation state changes;
- response payloads return `{ interaction_answer }` with `interaction_id`, `interaction_status`, `answer_audit_ref`, `step_result_ref`, `run_control_transition`, `blocked_reason`, and live event ids;
- resumable checkpoints return HTTP `200` with `interaction_status=resumed`, a `run_control_transition`, and query-safe live event ids;
- non-resumable boundaries return HTTP `409` with `error.code=interaction.continuation_blocked` and keep the run blocked with evidence refs;
- live events and query payloads must reference `answer_audit_ref` and must not include the raw answer text.
- CLI, API, and web surfaces expose the same query-safe answer result; raw answer text is allowed only in the durable answer audit artifact, never in command output, read models, SSE payloads, or web snapshots.
- for runtime permission requests, `decision` is required; legacy free-text `answer` is only compatible with ordinary clarification questions.
- for runtime permission requests, answer submission records the structured decision but must not claim a pass unless an actual continuation or reinvocation has run. Current coarse external-process adapters report `continuation.reinvoke_required` after user approval so the next runtime action is explicit.
- `approve_once` applies only to the recorded operation. `approve_for_run` creates an expiring grant, but reuse still requires the same project, run, step, operation identity, canonical resource, and capability set after hard-deny checks pass; it cannot broaden resources or cross a step boundary and is not persisted globally.

## Operator request mutations (W32-S01)

Operator-initiated runtime work uses first-class request artifacts rather than
`run steer` text. The detached transport exposes:
- `GET /api/projects/:projectId/operator-requests` for sanitized summaries and refs;
- `POST /api/projects/:projectId/operator-requests` to create an `operator-request`;
- `POST /api/projects/:projectId/operator-requests/:requestId/actions` with `action=run` to compile the request into the selected routed step.

Create payload fields:
- `target_stage`, `intent_type`, `request_text`;
- optional `target_flow_id`, `target_refs[]`, `allowed_paths[]`, and `delivery_mode`;
- `delivery_mode` defaults to `no-write`; non-`no-write` modes require explicit allowed paths.

When `target_flow_id` points to a completed flow, operator-request creation and
execution must preserve completed-flow read-only behavior. Read-only inspection
intents (`analyze`, `explain`, `review`, `validate`) are allowed only with
`delivery_mode=no-write`; write/proposal intents or any non-`no-write` delivery
mode fail with an explicit completed-flow read-only error.

Run responses include `operator_request_ref`, `run_id`,
`routed_step_result_file`, `compiled_context_ref`, `proposal_refs`,
`patch_refs`, and `next_action_report_file`. Raw request text is omitted from
read/list payloads and command output; the durable request artifact is the
only raw-text storage location.

## Read surface baseline (module operations)

Read operations must reuse existing contract families and IDs rather than introducing API-only parallel shapes.

Run-level read baseline:
- run summaries include `context_lifecycle` when run-linked promotion decisions reference context assets, with context version refs, immutable provenance refs, and decision-trail history;
- run event history remains bounded and replay-safe;
- run policy history remains evidence-derived from `step-result` and `delivery-plan` outputs.
- `strategic_snapshot.planner_metrics` and `GET /api/projects/:projectId/planner-metrics` expose one `planner-metrics-snapshot` read model with `clean_close_rate`, `retry_rate`, `repair_rate`, and `blocker_rate`.
- `strategic_snapshot.finance_monitoring` and `GET /api/projects/:projectId/finance-monitoring` expose one `finance-monitoring-snapshot` read model with cost/latency grouping by project, route, bundle, compiler revision, and adapter.
- `GET /api/projects/:projectId/compiler-revisions` returns contract-backed `compiler-revision-status` reports so compiler lifecycle, compatibility, decision history, incidents, and evaluation lineage are queryable without opening raw files.
- `GET /api/projects/:projectId/next-action-report` returns the latest durable `next-action-report` if one exists, including `artifact_readiness` for mission/discovery/research/spec/planning diagnostics and `closure_state` for review, delivery, release, and learning final-stage evidence, or `null` when `aor next` has not materialized one yet. The read route does not generate or refresh the report.
- `GET /api/projects/:projectId/operator-requests` returns contract-backed operator-request records with `request_summary`, status, refs, and evidence links while omitting raw `request_text`.
- Empty projects must return `status=no-data`, `no_data=true`, and `value=null` per metric rather than claiming a zero success or failure rate.
- Planner metrics derive only from durable run, review, Runtime Harness, incident, and run-control audit artifacts; they do not mutate scheduler state.
- Finance monitoring separates `production_monitoring`, `offline_certification`, and `rehearsal` evidence classes. Production monitoring requires explicit event scope and must not be inferred from certification or rehearsal artifacts.

## Run-control baseline (module operations)

Command payload baseline:
- `command_id` (optional canonical id; generated when omitted and authoritative for idempotent retry);
- `expected_revision` (optional non-negative integer CAS guard);
- `reason` (optional text summary for operator intent);
- `target_step` (optional for `start`, required for `steer`);
- `require_validation_pass` (optional start-only boolean, defaults to true for public execution runs);
- `approved_handoff_ref` (optional start-only evidence ref for bounded execution provenance);
- `promotion_evidence_refs` (optional start-only evidence refs for delivery/release-safe execution start);
- `approval_ref` (required by high-risk policy guardrails when applicable).

Deterministic transition baseline:
- module compatibility may execute `run start` inline, while the detached HTTP lifecycle mutation reserves a durable `run-job`, starts a separate Node worker, and returns HTTP `202` before provider completion;
- `pause` allowed only from `running`;
- `resume` allowed only from `paused`;
- `steer` allowed from `running|paused` with explicit target step;
- `cancel` allowed from `running|paused`, resulting in terminal `canceled`.

Guardrail baseline:
- high-risk controls (`steer`, `cancel`) evaluate `approval_policy` + `risk_tiers` before apply;
- blocked actions still emit durable audit evidence and warning-style live-run events.

Durable audit baseline:
- every control action writes one durable `run-control-event-*.json` record under runtime reports;
- control records include `run_id`, `command_id`, `revision`, `action`, transition snapshot, guardrail decision, and `evidence_root`;
- state transitions and their command records are serialized by a per-run cross-process lease; the same command id and payload returns the stored result, reuse with different content conflicts, and a stale expected revision is rejected before mutation.

Full-journey execution baseline (W13):
- `run start` is the canonical public execution entrypoint for full-journey live runs;
- successful execution emits one run-linked `step-result` plus terminal `live-run-event` lineage;
- `run status` resolves that execution lineage without requiring harness-private execution state.
- `project verify` and `run start` both accept `route_overrides` and `policy_overrides` so provider-pinned routing can be applied deterministically through the public CLI surface.
- Full-journey runs may continue after a degraded `run start` only when public routed step, Runtime Harness, and adapter raw evidence were materialized. Missing execution evidence remains a hard blocker.

Asynchronous run-job baseline (W58-S05):
- accepted responses contain `run_id`, `job_id`, `status`, `revision`, `status_ref`, and `event_ref`;
- the durable job owns `queued|running|paused|waiting-input|canceling|succeeded|failed|canceled`, worker identity, heartbeat, CAS revision, and terminal evidence;
- the worker supervises a separate process group, observes durable pause/resume/cancel state, and escalates bounded cleanup from terminate to kill;
- SSE and CLI follow tail the JSONL journal by durable cursor, so appends from another process are delivered exactly once without a process-local emitter;
- `maxReplay=0` disables replay, positive replay is capped at 1000, and reconnect resumes after `after_event_id`;
- slow clients are disconnected when the bounded transport buffer rejects writes, and server shutdown closes active streams within a bounded interval;
- `run status --follow` remains attached until `run.terminal` or `SIGINT`, then removes its journal subscription and signal handler.

Interactive continuation target (W18-S01):
- when a routed step requests operator input, the run should preserve a query-safe `requested_interaction` payload in the run-linked step result;
- operator answers should be submitted through a control-plane command path that records answer audit evidence before any continuation attempt;
- answer submission payloads should include `run_id`, `interaction_id`, `answer`, and optional `reason`, `approval_ref`, or `answer_evidence_ref`;
- answer submission responses should include `interaction_id`, `interaction_status`, `answer_audit_ref`, `step_result_ref`, `run_control_transition`, and `blocked_reason` when continuation cannot proceed;
- continuation should resume the bounded run from the recorded interaction boundary when the checkpoint declares `resume_from_boundary`; non-resumable boundaries remain blocked with explicit evidence refs and reason codes;
- live event payloads should reference `requested_interaction` and `answer_audit_ref` without exposing raw answer text;
- web clients may present and submit the interaction, but the control plane remains responsible for validation, audit, and run-state transitions.
- the persisted `requested_interaction.state_history[]` ledger should preserve requested, answered, resumed, and blocked transitions with audit refs so clients can render the latest state without replaying raw logs.

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
- `request-repair` also returns the linked `quality_repair_request_ref`,
  request file, status, cycle id, source stage, attempt budget, blockers,
  evidence refs, and the `next-action-report` primary action that operators
  should run next;
- `approve` must be blocked unless linked `review-report` and Runtime Harness evidence both pass;
- delivery/release commands may require this approval through `require_review_decision` lifecycle flags that map to `--require-review-decision`.

Learning handoff baseline:
- `learning handoff` writes one public `learning-loop-scorecard` and one public `learning-loop-handoff`;
- existing public `incident-report` linkage is preserved instead of replaced when incident open/recertify already ran;
- closure artifacts are derived from public run, review, eval, audit, and incident evidence, not from harness-private observability shortcuts;
- closure artifacts preserve matrix-cell and coverage-follow-up metadata so the next required coverage cell remains machine-readable.

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
- `provider.heartbeat`
- `evidence.linked`
- `warning.raised`
- `run.terminal`

Reconnect and backpressure baseline:
- replay from `after_event_id` when provided;
- bounded replay window (do not allow unbounded buffers);
- preserve monotonic per-run event ordering via payload sequence.

## Detached HTTP transport baseline (W10-S03)

### Non-materializing read contract (W58-S01)

All module query functions, HTTP `GET` routes, CLI inspection commands, and the
packaged SPA first-load sequence resolve project and runtime paths through an
immutable `ProjectReadContext`. They inspect only state that already exists and
must never call runtime initialization as a success path or as error recovery.

For a clean project, reads return HTTP `200` with deterministic empty models:
`ProjectStateResponse.initialized=false`, `state_file=null`, empty collection
responses, `FlowListResponse.initialized=false`, null selected flow/run values,
and resolved runtime paths. `GET /`, `GET /app-config.json`, and
`GET /api/projects` follow the same no-write rule. Only explicit onboarding or
`project init` mutation commands may create `.aor` bootstrap artifacts.

Compatibility note: clients that previously relied on a read to materialize a
generated profile, onboarding report, or bootstrap packet must invoke the
initialization mutation first. Operation names and read URLs are unchanged;
implicit initialization is intentionally removed.

Connected-mode transport mapping is implemented for read, follow, and bounded mutation baseline:
- `GET /` for the packaged local SPA when the transport is started with an app static root;
- `GET /app-config.json` for no-store, redacted same-origin app configuration (`project_id`, `default_project_id`, minimal `projects[]` identities, package version, canonical API base, and control-plane metadata);
- `GET /api/projects` for local app-session project summaries;
- `GET /api/projects/:projectId/state` including `verification_plan` plan/status read-model data when available
- `GET /api/projects/:projectId/strategic-snapshot`
- `GET /api/projects/:projectId/planner-metrics`
- `GET /api/projects/:projectId/finance-monitoring`
- `GET /api/projects/:projectId/next-action-report`
- `GET /api/projects/:projectId/packets`
- `GET /api/projects/:projectId/step-results`
- `GET /api/projects/:projectId/quality-artifacts`
- `GET /api/projects/:projectId/delivery-manifests`
- `GET /api/projects/:projectId/promotion-decisions`
- `GET /api/projects/:projectId/compiler-revisions`
- `GET /api/projects/:projectId/runs`
- `GET /api/projects/:projectId/runs/:runId/events/history`
- `GET /api/projects/:projectId/runs/:runId/policy-history`
- `GET /api/projects/:projectId/runs/:runId/events` (SSE + replay parameters).
- `POST /api/projects/:projectId/run-control/actions`
- `POST /api/projects/:projectId/ui-lifecycle/actions`
- `POST /api/projects/:projectId/lifecycle-command/actions`
- `POST /api/projects/:projectId/interactions/answers`
- `POST /api/projects/actions` for explicit local add-project actions in the app session.

Local app project summary baseline:
- the project index is Workspace-scoped and may return
  `selected_project_id=null`, `default_project_id=null`, and `projects=[]` for a
  neutral launch;
- explicitly connected projects persist in the operator-local Workspace
  registry, but neutral launch never restores a sticky project as CLI context;
- `project_id` as the local app route key, `runtime_project_id` as the underlying runtime contract identity, `label`, `project_ref`, `project_profile_ref`, and `runtime_root`;
- `project_id` remains equal to `runtime_project_id` for the default single-project case; duplicate local profiles in one app session get a stable app-scoped `project_id` suffix so their runtime/evidence chains do not mix;
- `onboarding_summary` with `status`, `initialized`, `can_initialize`, `recommended_action`, user-facing blockers, and optional `profile_mismatch_candidate_project_ids` when the runtime root already contains initialized evidence for a different project profile id;
- `active_flow_summary` with active/completed flow counts and selected flow id when runtime state already exists;
- `read_only=true` because project-list reads must not initialize `.aor/`.

Detached read-model scale baseline:
- list/read-model routes that can fan out over `.aor` artifacts accept optional `?limit=<n>`;
- detached HTTP list routes default to a bounded 200-entry local-alpha window and cap explicit `limit` requests at 1000 entries;
- run event and policy history routes keep route-specific bounded replay windows and also accept `limit`;
- the alpha filesystem runtime root remains the system of record; no database or storage migration is implied.

Detached mutation payload baseline:
- run-control payload fields: `action`, `run_id`, `target_step`, `reason`,
  `approval_ref`, optional `command_id`, optional non-negative
  `expected_revision`, and optional paired `execution_plan_ref` /
  `execution_unit_id` for `start`; the pair is resolved against the exact
  current approved plan and fixes task refs in run state;
- run-control response reuses module parity fields: `command_id`, `revision`, `state_file`, `audit_file`, guardrail decision, transition, live event ids;
- blocked run-control transitions return `409` with `{ error: { code, message }, run_control }` while still persisting audit and lifecycle artifacts;
- ui lifecycle payload fields: `action`, `run_id`, `control_plane`;
- ui lifecycle response reuses module parity fields: `state_file`, `connection_state`, `headless_safe`, `idempotent`.
- lifecycle-command payload fields: `command`, `flags`;
- lifecycle-command response reuses CLI command output fields under `command_output` and adds transport-level `artifact_refs`, `evidence_refs`, `blocked`, and `blocked_reason`;
- `run integration` lifecycle commands use the same endpoint. `show` is read-only;
  `apply`, `verify`, `repair`, `hold`, and `resume` require parent ownership,
  `command_id`, and `expected_revision`. Run reads expose the additive
  integration report ref, aggregate gates, stale units, repair refs, and blocker.
- interaction answer payload fields: `run_id`, `interaction_id`, `answer`, `reason`, `approval_ref`, `answer_evidence_ref`;
- interaction answer response writes and references durable answer audit evidence before reporting whether continuation remains blocked.
- project action payload fields: `action=add`, `project_ref`, optional `runtime_root`, optional `project_profile`, and optional `label`;
- project action response returns the added project summary and the refreshed local `projects[]` list.

The OpenAPI component names that own these local-alpha payloads are
`ProjectStateResponse`, `RunsResponse`, `RunEventHistoryResponse`,
`RunControlActionRequest`, `RunControlActionResponse`,
`UiLifecycleActionRequest`, `UiLifecycleActionResponse`,
`LifecycleCommandActionRequest`, `LifecycleCommandActionResponse`,
`InteractionAnswerRequest`, `InteractionAnswerResponse`,
`ProjectIndexResponse`, `ProjectActionRequest`, and
`ProjectActionResponse`.

Detached mutation error-shape baseline:
- `invalid_host` for a Host value different from the bound listener authority;
- `cross_origin_mutation_denied` for foreign/null browser Origin or browser fetch metadata without Origin;
- `unsupported_media_type` (`415`) for mutation bodies outside the JSON media families;
- `request_body_too_large` (`413`) and `request_body_timeout` (`408`) for bounded body-reader rejection;
- `invalid_json` for malformed request body;
- `invalid_payload` for non-object JSON payload;
- `invalid_run_control_action`, `invalid_ui_lifecycle_action`, and `invalid_lifecycle_command` for unsupported actions;
- `invalid_lifecycle_flags` and `interaction_answer.invalid_answer` for malformed mutation inputs;
- `run_control.blocked` family codes for policy or transition blocking branches.
- `lifecycle_command.blocked`, `lifecycle_command.interaction_required`, and `interaction.continuation_blocked` for bounded command and non-resumable continuation branches.

Detached authn/authz baseline (W10-S04):
- auth mode is optional and disabled by default for local trusted operator rehearsals;
- when auth is enabled, requests require `Authorization: Bearer <token>`;
- tokens are project-scoped and permission-scoped (`read` and `mutate`);
- `local-trusted` auth keeps backward-compatible `read+mutate` defaults for tokens without explicit `permissions`;
- `production-hardened` auth does not infer default permissions; missing, empty, or invalid-only permission arrays leave the token with no route authorization;
- missing or invalid credentials return HTTP `401` with `error.code` in `auth.missing_credentials | auth.invalid_token`;
- project mismatch or missing permission return HTTP `403` with `error.code` in `auth.forbidden_project | auth.insufficient_permission`;
- auth error payload includes `error.auth.required_permission`, `error.auth.project_id`, and `error.auth.token_id` (when available).

Deferred beyond this baseline:
- mutation-command HTTP endpoint parity for commands outside the supported W18 lifecycle subset;
- hosted deployment hardening beyond the bounded self-hosted alpha.

## API/UI alignment notes (W5-S04 + W9-S03 + W10-S03)

- The local web console reads run/evidence state through same-origin HTTP/SSE when launched by `aor app`, or through detached HTTP/SSE when an explicit `control_plane` is configured.
- Connected-mode web mutation actions for run-control and UI lifecycle route through detached HTTP mutation endpoints.
- Headless/disconnected web operation remains module-backed and in-process.
- Detach behavior is UI-local only: detaching unsubscribes the web listener while runtime artifacts stay owned by orchestrator runtime.
- Connected-mode fallback and headless-safe semantics remain explicit through `ui-lifecycle` state.
- The Mission form posts `command: "mission create"` to `POST /api/projects/:projectId/lifecycle-command/actions`, then posts `command: "next"` to refresh the durable next-action report. The safe walkthrough template only populates existing intake fields and does not alter packet schemas.

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
- expose verdict and closure artifacts through public module surfaces before relying on private aggregation;
- keep operation and query shapes aligned with contract docs and CLI catalog.
