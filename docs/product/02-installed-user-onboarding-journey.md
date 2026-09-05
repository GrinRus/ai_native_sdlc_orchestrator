# Installed-user onboarding journey

## Purpose
This is the source-of-truth journey contract for an installed user who starts with a local repository and wants AOR to guide the full SDLC loop without reading internal implementation docs first.

The journey is additive over the existing runtime-owned commands, control-plane mutations, reports, packets, and read models. It does not replace low-level commands, make the web UI mandatory, or allow UI-owned orchestration.

## User outcome
An installed user can launch the local UI, connect a repository, create and
prepare a Task without source writes, explicitly start bounded work, and follow
activity, review, completion, and evidence through a durable Task record with
no surprise upstream writes.

## Stage model
| Stage | Guided intent | Runtime-owned evidence | Owning follow-up slice |
|---|---|---|---|
| Launch and connect | Open `aor app`, select an existing project, or connect a local Git repository. | Workspace project registry, project profile, readiness and analysis reports. | W70-S03, W70-S08 |
| Task draft | Choose **New task**, describe the outcome, and attach optional Markdown sources. | Server-owned Task submission and source metadata. | W70-S04 |
| Prepare | Choose **Prepare task** to derive a reviewable outcome, acceptance criteria, scope, runner, and safety mode without authorizing source writes. | Preparation run, prepared Task state, logical evidence refs. | W70-S04 |
| Start and work | Explicitly choose **Start task**, then observe bounded activity, changes, checks, blockers, and live events. | Task/run linkage, step results, live-run events, policy and run-control evidence. | W70-S05 |
| Ask AOR | Request bounded analysis, revision, repair, validation, planning, implementation, or review from the selected Task. | `operator-request`, compiled context, step result, proposal/patch refs. | W70-S05 |
| Review and completion | Resolve attention, inspect review and QA evidence, and retain the completed Task as a durable read-only outcome. | Review report and decision, Runtime Harness report, completion and closure evidence. | W70-S06 |
| Follow-up | Create a fresh Task that may cite prior evidence without mutating the completed source Task. | New Task submission plus preserved internal Flow and evidence lineage. | W70-S06 |
| Guided proof | Rehearse the clean-project Task journey with no upstream-write defaults. | `installed-user-guided-journey.yaml`, current app-smoke fields, browser Task proof, durable readback, and no-write assertions. | W70-S09 |

## Advanced and headless command vocabulary
These public commands remain the scriptable compatibility and automation
surface. The primary installed-user vocabulary is the Task action model above.
W21 established the guided command shell and evidence, while W31 made `aor app`
the real local app launcher; W70 supersedes the older mission-first UI without
removing the underlying commands.

| Guided command | Intent | Low-level ownership |
|---|---|---|
| `aor doctor` | Read environment and repository readiness before mutation. | source validation, project-profile resolution, and AOR Home readiness checks. |
| `aor onboard <repo>` | Prepare or inspect a repository using explicit asset-mode behavior. | Project bootstrap, analysis, validation, project-profile registry roots. |
| `aor mission create` | Capture product mission evidence in one guided intake flow. | `intake-request-body` packet evidence with goals, constraints, KPI/DoD, source refs, allowed paths, and delivery mode. |
| `aor next` | Recommend one deterministic next action and explain blockers. | `next-action-report` over onboarding reports, intake packets, run-control state, bounded write-back policy, and closure evidence. |
| `aor app` | Start the optional local SPA console for the current project. | Shared HTTP/SSE control-plane transport, packaged `apps/web/dist`, `/app-config.json`, same-origin API routes, `ui attach` lifecycle state. |
| `aor request create/run/status` | Create and run bounded operator interventions from any stage. | `operator-request` contract, routed step execution, compiled-context refs, proposal/patch evidence, next-action refresh. |

Low-level commands remain stable, scriptable, and machine-readable. Guided commands may default to human-readable output, but they must preserve machine-readable evidence refs whenever the underlying command already exposes them.

## Web state model
The optional web console mirrors the same stages with these states:
- `read_only`: the web surface can inspect runtime evidence but cannot mutate state.
- `local`: the foreground `aor app` process serves the SPA and same-origin control-plane routes for the selected project.
- `connected`: the web surface uses detached HTTP/SSE read and mutation endpoints.
- `detached`: the web surface unsubscribes while CLI/API/headless runtime operation remains available.
- `blocked`: the current stage has explicit blockers, missing evidence, or policy gates.
- `ready`: the current stage has one safe next action.

The web app must not invent separate lifecycle state. It reads control-plane state and invokes runtime-owned mutations. Static generated HTML snapshots are not a product console surface.

The current implemented console reference is
`docs/product/08-task-workspace-console-design.md`. W70 owns the Tasks Home,
Task draft and preparation, explicit start, active work, Attention, review,
completion, follow-up, and responsive behavior shipped by the packaged app.
Older flow-centric and cockpit designs remain available in Git history as
migration evidence; they do not define the installed default.

Project-topology and detailed planning behavior is defined in
`docs/product/04-project-topology-and-task-planning-ux.md`. W60-W62 preserve the
internal Flow lifecycle boundary and headless topology, planning, and execution
contracts. Their Project Structure, Execution Setup, and Plan workbench screens
have been retired. Use the public project, route, and plan commands for those
operations; Task Workspace presents applicable plan and execution evidence
inside the selected Task. Integrated recovery and coordinated-delivery proof
remain bounded by the current W71 acceptance requirements.

A flow is a runtime/control-plane projection over mission/intake, next-action,
operator-request, run, review, delivery, release, and learning evidence.
Active internal flows can invoke runtime-owned lifecycle mutations. Completed
flows are read-only evidence chains. A new or follow-up Task creates fresh
submission and mission/intake evidence; it may cite a completed learning
handoff without mutating the completed source Task or its internal flow.

W31-S01 added the installed-package local app mode, W36 made it the primary
no-settings UI path, and W70 replaced that path's visible object with Tasks:
- `aor app --project-ref <repo>` starts a foreground loopback server and opens the packaged SPA by default;
- `cd <repo> && aor app` is the primary installed-user quickstart; `doctor` and `onboard` remain advanced/headless shortcuts;
- `/` serves the SPA, while `/app-config.json` returns the selected workspace project, `default_project_id`, `projects[]`, package version, API base, and control-plane metadata; runtime placement is server-owned under AOR Home and is not part of the public config contract;
- `GET /api/projects` returns explicit local project summaries without scanning the filesystem or initializing `.aor/`;
- `/api/projects/:projectId/**` remains the control-plane route family used by CLI/API/headless flows;
- `aor app --smoke true --open false --json` validates the real SPA, config, project index, state routes, Task Workspace, **New task**, **Prepare task**, project-switcher markers, and absence of retired renderers;
- if no project is connected, the Task surface asks for a local Git repository before Task preparation; preparation remains read-only;
- returning users land on Tasks Home, where they can resume a Task or start a new one; unfinished Task submissions are resumable after reload.

The optional web console exposes lifecycle evidence only after a Task is selected:
- readiness;
- mission;
- discovery/spec/plan;
- execution;
- review/QA;
- delivery/release;
- learning.

Tasks Home and New task have no lifecycle rail. Prepared Task is a review
surface; preparation does not authorize source changes. **Start task** is the
explicit boundary that permits the bounded runtime to begin work.

Each selected Task stage exposes durable evidence refs, blocker codes,
selected-run policy history counts, event/log counts, and the exact current
next action from the latest `next-action-report`. Connected mode invokes
`mission create`, `next`, and other bounded lifecycle commands through
`POST /api/projects/:projectId/lifecycle-command/actions`; read-only mode keeps
the same evidence visible while disabling mutation descriptors.

The pre-W67 Mission form used a safe walkthrough template. W67 supersedes that first-run surface: free-form intent normalization now compiles title, goals, constraints, KPI, Definition of Done, and bounded delivery mode before confirmation, while UI state exposes logical evidence refs and server-owned AOR Home status.

Each selected Task exposes an Ask AOR action. The request drawer captures
intent, target refs, allowed paths, delivery mode, and a preview of what runtime
will do. Runtime may retain an internal `target_flow_id`; the installed UI keeps
the request and refreshed activity scoped to the Task. Submitting creates an
`operator-request` and runs it through the selected target step. Task activity,
checks, changes, and evidence remain scoped to the selected Task; refs can be
attached as request targets. The Interactions Inbox remains
for runtime-initiated `requested_interaction` questions and submits answers
through `/interactions/answers`; it is distinct from operator-initiated
`operator-request` work.

For the final three stages, the web console reads `next-action-report.closure_state` directly:
- review/QA shows review report, Runtime Harness report, current `review-decision`, downstream delivery gate status, and whether downstream delivery is blocked;
- delivery/release shows delivery-plan, delivery-manifest, release-packet, write-back result, release readiness, and blocked reasons;
- learning shows scorecard and handoff refs plus the evidence chain that links back to review, quality, delivery, and release artifacts.

The web surface does not store approval, hold, repair, release, or learning state locally. It only renders durable artifacts and invokes the same lifecycle mutations that CLI/API expose.

## Safety defaults
Installed-user onboarding defaults to public-repo safety:
- no upstream writes by default;
- `no-write` or planning-only behavior until delivery mode is explicit;
- bounded execution scope, commands, budgets, allowed paths, and writeback policy before runner work;
- runtime output under AOR Home (`~/.aor` or `AOR_HOME`), with no runtime state committed;
- headless CLI/API operation remains valid when the local app is absent, stopped, or detached;
- production monitoring, offline certification, rehearsal proof, and delivery evidence stay separate.

Risky actions must point to the exact missing approval, handoff, review, promotion, policy, or writeback evidence instead of silently falling through to a weaker path.

## Contract map
Guided UX composes existing contract families and a small set of additive
fields. The minimum contract ownership is:

| Contract area | Current source of truth | Evolution ownership |
|---|---|---|
| Project identity and registry roots | `project-profile` | W21-S03 adds explicit `asset_mode` semantics and bundled/materialized registry-root resolution. |
| Bootstrap readiness | `project-analysis-report`, `validation-report` | W21-S03 adds an onboarding report that records readiness, blockers, asset mode, next action, and no-surprise-write evidence. |
| Product mission | `intake-request-body` | W21-S04 preserves goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode. |
| Next action | `next-action-report` | W21-S04 resolves one primary action with blockers, evidence refs, mission state, active run state, and explicit write-back policy; W21-S06 adds `closure_state` for review, delivery, release, and learning. |
| Web lifecycle | `control-plane-api`, `live-run-event` | W21-S05 maps guided stages to read models and lifecycle mutations without UI-owned orchestration; W31-S01 adds the packaged local SPA launcher; W70 maps the packaged UI to server-owned Task records while preserving internal Flow lineage. |
| Operator intervention | `operator-request`, `compiled-context-artifact`, `step-result` | W32-S01 adds runtime-owned Ask AOR/request behavior across CLI, API, and web without creating a chat-only bypass; W70 scopes the visible request and evidence to the selected Task. |
| Closure | `next-action-report`, `review-decision`, `delivery-plan`, `delivery-manifest`, `release-packet`, `learning-loop-handoff` | W21-S06 exposes final-stage decisions, blockers, evidence refs, and exact next actions consistently across CLI/API/web. |
| Task and Flow projection | `control-plane-api`, Task read models, `intake-request-body`, `next-action-report`, `operator-request`, closure artifacts | W70 exposes Tasks as the installed-user object while runtime-owned active/completed Flow semantics remain internal lineage; completed evidence is read-only and follow-up Tasks preserve source lineage. |
| Proof | Internal installed-user proof artifacts and quality assessment reports | W21-S07 establishes clean-project and no-write evidence; W70-S09 requires current Task smoke markers, browser Task lifecycle proof, durable readback, completion/follow-up coverage, and post-run quality assessment refs. |

Bare `aor app` from a neutral non-Git directory opens the operator-local Local
Workspace without selecting a project or creating launcher state. Explicitly
added projects persist across restarts; repo-attached launch remains a
session-scoped compatibility shortcut.

## Out of scope for the guided journey contract
- changing the implementation of `aor doctor`, `aor onboard`, `aor mission create`, `aor next`, or `aor app`;
- changing low-level command output shapes;
- changing packet schemas for UI-only intake fields;
- making the web UI mandatory;
- promoting OpenCode beyond extended candidate coverage before a future real-runner certification proves it.
