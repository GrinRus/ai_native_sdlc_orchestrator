# Flow-centric operator console product baseline

## Purpose

This document freezes the accepted product direction and W34 contract baseline
for the next AOR local console iteration. It is not an implementation claim:
W34-S01 defines the runtime-owned flow semantics, while later W34 slices add
runtime projections, web rendering, and live E2E proof.

The design keeps AOR headless-first and runtime-owned: the web app renders
control-plane read models, invokes bounded runtime mutations, and never owns
orchestration state.

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
- Advanced views must be flow-scoped: evidence graph, runtime trace,
  interactions inbox, and Ask AOR request targeting.
- The design must remain usable without hosted services, SSO, SaaS deployment,
  CORS expansion, or upstream writes by default.

## Live E2E implications

The installed-user guided proof should be refreshed through the current
skill-agent-only live E2E model so it proves the full flow-centric loop:

1. Launch `aor app` and validate the browser-task frontend proof path.
2. Create and complete the first flow through durable evidence.
3. Render the completed flow as read-only.
4. Start a second flow from learning closure or the flow selector.
5. Prove that the second flow writes a new mission/intake packet.
6. Prove that operator-request targeting includes the selected flow.
7. Preserve the existing no-upstream-write default.
8. Preserve frontend evidence refs for rendered HTML, DOM snapshot,
   accessibility summary, screenshot or visual evidence, task outcome, UX
   findings, and accepted skill-agent UI/UX verdict.
9. Preserve the final skill-agent verdict request, accepted final verdict, and
   non-empty inspected evidence refs.

## Out of scope

- Implementing the redesign in this document.
- Introducing UI-owned orchestration state.
- Replacing CLI/API/headless operation.
- Reintroducing static HTML console snapshots.
- Adding hosted SaaS, multi-tenant collaboration, SSO, or default upstream
  write-back.
