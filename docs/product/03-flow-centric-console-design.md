# Flow-centric operator console product baseline

## Purpose

This document freezes the accepted product direction and W34 contract baseline
for the next AOR local console iteration. W34-S01 defines the runtime-owned flow
semantics; W34-S02 implements the control-plane/runtime flow projections; W34-S03
renders the packaged flow-first local web shell; W34-S04 adds flow-scoped
evidence graph, runtime trace, interaction, and Ask AOR targeting behavior
while later W34 slices add browser-task installed-user proof.

The design keeps AOR headless-first and runtime-owned: the web app renders
control-plane read models, invokes bounded runtime mutations, and never owns
orchestration state.

## Status and successor direction

This document remains the implemented W34 product baseline and preserves the
history needed to explain the current packaged console. It must not be rewritten
as though a later visual concept already shipped.

The adopted W63 target successor is
`05-quiet-cockpit-console-design.md`: Quiet Cockpit is the eventual installed
default shell, with flow-scoped Attention, Journey, and Evidence modes. That target keeps the Flow
semantics in this document, but changes information hierarchy, action
semantics, responsive navigation, and the visual system. W63-S01 now supplies
the executable journey/action scenario baseline without changing this
renderer. W34 remains the
installed default while W63 implements and accepts the successor behind an
explicit selector. W65 owns the packaged-default cutover, rollback rehearsal,
legacy removal, and final installed-package acceptance.

## Baseline

- Design name: AOR Flow-Centric Operator Console v1.
- Baseline date: 2026-05-27.
- Owning backlog wave: W34 - flow-centric console refactor and browser-task
  proof.
- Product scope: installed-user local console launched through `aor app`.
- Runtime scope: flow projections over existing mission, next-action,
  operator-request, run, review, delivery, release, and learning evidence.

## Core interaction model

The primary object in the console is a flow.

- The top bar always exposes the selected project, runtime root, flow selector,
  and `New Flow`.
- An active flow can advance through the guided stages by invoking runtime-owned
  lifecycle mutations.
- A completed flow is rendered as a read-only evidence chain.
- Starting a new flow creates a new mission/intake packet and then refreshes the
  next-action report.
- A follow-up flow may link back to a learning handoff from a completed flow,
  but it must not mutate the completed flow.
- Operator requests must declare the selected flow, target stage, delivery mode,
  and target refs.
- Runtime-initiated interactions stay separate from operator-initiated Ask AOR
  requests.

## Flow projection baseline

A flow is a runtime/control-plane projection over durable AOR evidence. It is
not a browser session object and it is not a replacement for mission, intake,
next-action, run, review, delivery, release, or learning contracts.

The minimum projected fields are:
- `flow_id`, stable for one mission/intake lineage.
- `status`, with `active` for a mutable in-progress flow and `completed` for a
  read-only evidence chain.
- `selected_stage`, derived from the latest next-action and closure evidence.
- `mission_id`, `intake_packet_ref`, and `intake_body_ref`.
- `latest_next_action_report_ref`.
- `evidence_refs[]`, the flow-scoped evidence chain visible to CLI/API/web.
- `writeback_policy`, copied from mission scope and delivery evidence.
- `follow_up_source_handoff_ref`, present only when a new flow starts from a
  completed learning handoff.

Creating a new flow always creates fresh mission/intake evidence and then
refreshes `next-action-report`. A follow-up flow may cite a completed source
flow's learning handoff, but the completed source flow remains read-only.

## Screen references

| Screen | Reference |
|---|---|
| Readiness / first launch | ![Readiness / first launch](assets/w34-flow-centric-console/01-readiness-first-launch.png) |
| Flow selector / new flow | ![Flow selector / new flow](assets/w34-flow-centric-console/02-flow-selector-new-flow.png) |
| Active flow cockpit | ![Active flow cockpit](assets/w34-flow-centric-console/03-active-flow-cockpit.png) |
| Ask AOR with flow target | ![Ask AOR with flow target](assets/w34-flow-centric-console/04-ask-aor-flow-target.png) |
| Evidence graph with multi-flow context | ![Evidence graph with multi-flow context](assets/w34-flow-centric-console/05-evidence-graph-multi-flow.png) |
| Runtime trace by flow | ![Runtime trace by flow](assets/w34-flow-centric-console/06-runtime-trace-by-flow.png) |
| Interactions inbox with flow boundary | ![Interactions inbox with flow boundary](assets/w34-flow-centric-console/07-interactions-inbox-flow-boundary.png) |
| Review / QA flow gate | ![Review / QA flow gate](assets/w34-flow-centric-console/08-review-qa-flow-gate.png) |
| Delivery / release finalization | ![Delivery / release finalization](assets/w34-flow-centric-console/09-delivery-release-finalization.png) |
| Learning closure / start new flow | ![Learning closure / start new flow](assets/w34-flow-centric-console/10-learning-closure-start-new-flow.png) |

## Required implementation qualities

- The UI must show one safe next action at a time.
- Flow state must come from control-plane/runtime read models, not browser-only
  state.
- Completed flows must remain inspectable and read-only.
- The `New Flow` path must be available from the flow selector and from learning
  closure.
- Safety gates, blockers, write-back mode, runtime root, evidence refs, and
  latest operator request status must stay visible in the main cockpit.
- Long-running external provider steps must show a query-safe heartbeat in the
  stage rail and active cockpit: provider, adapter, route, step, elapsed time,
  timeout budget, remaining time, last update, and recommended action.
- Advanced views must be flow-scoped: evidence graph, runtime trace,
  interactions inbox, and Ask AOR request targeting.
- The design must remain usable without hosted services, SSO, SaaS deployment,
  CORS expansion, or upstream writes by default.

## W34-S03 implementation trace

The packaged SPA now treats the flow as the primary object:

- The top bar exposes project identity, selected flow, runtime root, connection
  status, no-write safety status, refresh, and `New Flow`.
- `New Flow` opens mission intake as a draft and still creates durable evidence
  only through `mission create` followed by `next`.
- Active flows render an active cockpit with one recommended action, blockers,
  evidence artifacts, runtime root, write-back mode, and safety status.
- When the operator has not manually selected a completed or future stage for
  inspection, the stage rail, compact stage strip, active cockpit heading, and
  next-action context must agree on the current runtime stage.
- Live-run step names that are more granular than the seven UI stages must map
  to the owning grouped stage before rendering progress. For example, `spec`
  and `handoff` stay under `Discovery / Spec / Plan`, while `eval` and
  `harness` stay under `Review / QA`; they must not fall through to
  `Delivery / Release`.
- When run-health is blocked on a granular live-run step, the context cards and
  stage-specific panel must explain that step's concrete evidence boundary. A
  `handoff` blocker should mention handoff packet, wave ticket, and execution
  scope evidence instead of generic discovery outputs.
- The active cockpit explains the single recommended action as an operator
  outcome first; raw lifecycle commands stay available through technical
  details or copy/debug affordances instead of competing with the primary CTA.
- Blocking run-health evidence takes priority over the selected-flow next
  action. When the latest run-health projection is blocked, the active cockpit,
  stage rail, right rail, and top-bar action show the concrete recovery state
  before normal flow actions resume. A substantive run failure uses blocker
  language such as `Execution blocked` and `Review blocker`; a pending
  controller request without a substantive failure uses decision language such
  as `Run decision needed` and `Decision needed`; a product-change step-quality
  gate uses assessment language such as `Run assessment needed` and
  `Assessment needed`. The cockpit primary CTA opens the matching workbench
  surface (`Decision Request`, `Assessment Evidence`, `Recovery Path`, or
  `Review Blocker`); refresh remains secondary while the run is waiting on
  operator or evaluator action. Repair-required states with an accepted
  diagnosis, public repair command, retry intent, or target verification
  failure use recovery language such as `Recovery needed`, `Recovery Path`,
  and `<step> repair required`. If a substantive blocker also includes a
  materialized `pending_decision.request_ref`, `Decision Request` remains the
  primary CTA so the operator can record the required diagnosis before retry or
  repair.
- During the first project snapshot load, the console shows a non-actionable
  `Syncing project state` card and disables flow actions until active-flow,
  run-health, and evidence state are known. It must not briefly show
  `Configure First Flow` for an initialized project with an active run. Once
  the base snapshot is known, the active cockpit is shown even if advanced
  evidence graph or runtime trace hydration is still finishing.
- The stage rail and active cockpit render `provider_step_status` from public
  control-plane read models. `silent-running` states explicitly say the provider
  has no output yet but is still running, without exposing raw process commands
  or secrets.
- Provider execution status takes priority over a previously accepted
  `continue` gate for the same live-run step while provider output is running
  or has just completed. The console must show provider monitoring copy,
  elapsed/remaining budget, and the latest run-control status instead of a
  stale accepted decision reason such as a completed handoff step-quality gate.
  Once run-health includes a materialized `request_ref` or
  `expected_decision_ref`, that operator decision request becomes the primary
  workbench action.
- Accepted non-continue decisions remain explainable. When an operator records
  `diagnose`, `retry_public_step`, or `block`, the console must keep the source
  request, accepted decision ref, and any linked step-quality repair status
  visible, and must describe the safe next public control path instead of
  implying that the same decision still needs to be recorded. The primary CTA
  must move to the repair or blocker workbench after the decision request is
  accepted.
- Repair next actions must be executable as shown. If a review- or QA-origin
  repair requires approved handoff or promotion evidence, the generated
  `aor run start ...repair` command must carry those refs so first-time users do
  not hit an avoidable terminal guardrail failure. After `request-repair`
  materializes a quality repair `next-action-report`, that repair next-action
  takes precedence over stale blocked run-health diagnosis copy in the cockpit,
  right rail, and Execution Evidence recovery path. Failed required
  verification remains visible as repair input, but it must not hide the
  materialized repair run behind a generic "rerun verification first" action.
  If the public runs list already contains the matching completed `.repair`
  run, the UI must not offer the same repair command again; it should preserve
  the completed repair evidence, show completed repair status, and point the
  operator at run status or post-run verification. If the latest required
  post-run verification fails after that repair completion, the failed
  verification overrides completed-repair guidance: the cockpit, right rail,
  and verification banner must show the failed command-group count, failed
  step-result refs, and blocked next step as the next repair input.
- Evidence lists render `artifact_display_summaries[]` as user-facing
  artifact chips, grouped rows, and graph/trace labels. Long raw filesystem
  paths, packet URIs, and evidence URIs are not primary visible text; raw refs
  stay available only through copy/debug actions.
- The Operator Decision drawer is action-first: `Continue`, `Diagnose`,
  `Block`, `Retry public step`, `Answer`, and `Frontend interact` prepare the
  same manual installed-user decision-helper path from `agent_decision_request_ref`.
  Rejection reasons are shown as readable copy, and pending decisions expose
  copy actions for a selected-action handoff bundle, action note, and expected
  operator-decision file. Rejected decisions render a correction-required
  recovery panel with the rejected reason, rubric coverage, expected file
  availability, and copyable correction payload. Raw request refs and handoff
  payloads remain behind copy/debug actions.
- The Execution Evidence panel renders `RunSummary.execution_evidence` for the
  selected flow: provider status, Runtime Harness decision, real-code-change
  status, post-run verification, review, delivery readiness,
  no-upstream-write status, changed-path relevance groups, blockers, and public
  stop/save/diagnose/retry controls. The panel shows an execution recovery path
  before raw controls so interrupted or blocked runs name the current state,
  provider evidence to preserve, and the next public control to use. When
  run-health exposes a repair-required blocker and
  `pending_decision.public_repair_command`, the panel promotes that public
  repair command with the current `--project-ref`, `--project-profile`,
  `--runtime-root`, and `--run-id` context instead of falling back to generic
  diagnose/retry controls. When the latest `next-action-report` already points
  at the follow-up repair run, the panel promotes the `aor run start ...repair`
  next-action instead of re-showing the earlier `review decide` command. When
  that repair run is already completed in the public runs list, the panel shows
  `Repair run completed` guidance and a safe `aor run status --json --run-id`
  command instead of asking the operator to start the same repair run again.
  When a later `post-run-primary` verify summary is failed, the panel must stop
  using the completed repair run as the primary action and promote the failed
  verification evidence for the next repair loop.
  Scratch-only output is explicitly non-passing, while `.qwen/`, `.codex/`,
  `.claude/`, and `.opencode/` target checkout state is shown as blocking
  runner-owned leakage.
- Active review/QA repair gates render as recovery paths before raw gate
  details: the panel shows the current repair step, compact next command,
  linked repair evidence summaries from the flow projection, blocker count, and
  delivery/release exit condition so first-time operators can see why delivery
  remains blocked and what closes the loop.
- Required verification failures render as alert-level recovery paths before
  raw failed group details: the panel shows failed required command group count,
  the held downstream action, verify summary evidence, rerun command, and the
  review/QA/delivery unlock condition.
- Completed flows render as read-only closure/evidence views with mutation
  controls disabled or replaced by no-write inspection actions.
- Ask AOR submissions include `target_flow_id` for the selected flow; completed
  flows only allow no-write inspection intents.
- The stage rail remains flow-scoped navigation, not lifecycle state ownership.

## W34-S04 implementation trace

The advanced workbench is flow-scoped:

- Evidence & Documents renders a quality closure path before raw artifact
  tables. The path separates factual run-health status from outcome-quality
  judgement and shows whether review/QA evidence, deterministic gate or
  delivery evidence, and assessment evidence are visible before the operator
  treats a flow as quality-closed.
- Evidence Graph reads use
  `GET /api/projects/:projectId/flows/:flowId/evidence-graph` and render only
  selected-flow refs plus sanitized operator requests that target the selected
  flow. Empty or partial graph states render a readiness path that names the
  selected-flow scope, loaded node count, and refresh/create-evidence recovery
  step before the operator treats traceability as missing.
- Runtime Trace reads use
  `GET /api/projects/:projectId/flows/:flowId/runtime-trace` and link run
  events, step results, Runtime Harness decisions, delivery/release artifacts,
  learning artifacts, and operator requests for the selected flow. Empty trace
  states use the same readiness pattern so the operator can refresh run status
  or preserve execution evidence before judging outcome quality.
- Ask AOR requires a selected flow and target refs before creating a request;
  request creation sends `target_flow_id`, target stage, intent, delivery mode,
  allowed paths, and target refs. The drawer renders a request-readiness path
  so blocked submission states name the missing flow, request text, target refs,
  scope, or read-only-compatible mode before the operator tries to submit.
- Runtime-requested interactions remain in the Interactions Inbox and continue
  through the public `/interactions/answers` control-plane mutation. The
  detail panel renders an answer recovery path with the selected runtime
  question, step-result evidence, answer type/reason fields, and the audit-ref
  refresh condition that unlocks continuation.
- Sanitized read payloads omit raw operator request text while preserving
  summaries and refs.

## W34-S05 implementation trace

Learning closure now provides an explicit safe transition into the next flow:

- Completed flow projections expose `closure_state.follow_up_eligible`,
  `source_learning_handoff_refs[]`, `recommended_follow_up_source_handoff_ref`,
  and duplicate-safe `mission_settings`.
- `aor next` resolves completed learning closure to a `start-new-flow` primary
  action backed by `mission create --follow-up-source-handoff-ref <ref>` when a
  learning handoff exists.
- The web closure cockpit keeps completed evidence read-only and offers
  `Start New Flow`, `Create follow-up from learning handoff`, and
  `Duplicate mission settings`.
- Follow-up and duplicate submissions still go through the public lifecycle
  command mutation, create fresh mission/intake packets, run `next`, and keep
  `upstream_writes_default=false`.

## Installed-User Proof Implications

The installed-user guided proof should be refreshed through the current
skill-agent-only installed-user model so it proves the full flow-centric loop:

1. Launch `aor app` and validate the browser-task frontend proof path.
2. Create and complete the first flow through durable evidence.
3. Render the completed flow as read-only.
4. Start a second flow from learning closure or the flow selector.
5. Prove that the second flow writes a new mission/intake packet.
6. Prove that operator-request targeting includes the selected flow.
7. Preserve the existing no-upstream-write default.
8. Preserve AOR operator UI evidence refs for rendered HTML, DOM snapshot,
   accessibility summary, screenshot or visual evidence, task outcome, UX
   findings, and inspected browser-task evidence.
9. Preserve run-health refs and post-run quality assessment refs with non-empty
   inspected evidence refs for evaluated dimensions.

## W34-S06 implementation trace

The installed-user guided profile now makes the flow loop part of the proof
contract:

- The installed-user guided profile declares browser-task, flow-loop,
  flow-targeted request, quality-assessment, and no-upstream-write
  requirements without expanding the public CLI/runtime surface.
- Guided proof generation records the first completed flow, completed-flow
  read-only state, a distinct follow-up flow, the learning handoff lineage,
  the second-flow intake/next-action files, and
  `operator_request.target_flow_id`.
- Frontend evidence records rendered HTML, DOM snapshot, accessibility summary,
  screenshot or visual guardrail refs, task outcome, UX findings, and a
  browser-task proof ref. Current UI checks include horizontal overflow,
  keyboard focus, and interactive target sizing: desktop controls keep at least
  a 40px shared target and mobile controls keep the 44px touch target.
- Acceptance remains fail-closed when browser-task proof, flow-loop fields,
  run-health evidence, required assessment refs, inspected refs, or no-upstream-write
  assertions are missing.

## Out of scope

- Implementing the redesign in this document.
- Introducing UI-owned orchestration state.
- Replacing CLI/API/headless operation.
- Reintroducing static HTML console snapshots.
- Adding hosted SaaS, multi-tenant collaboration, SSO, or default upstream
  write-back.
