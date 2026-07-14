# Installed-user onboarding journey

## Purpose
This is the source-of-truth journey contract for an installed user who starts with a local repository and wants AOR to guide the full SDLC loop without reading internal implementation docs first.

The journey is additive over the existing runtime-owned commands, control-plane mutations, reports, packets, and read models. It does not replace low-level commands, make the web UI mandatory, or allow UI-owned orchestration.

## User outcome
An installed user can connect a repository, understand readiness, launch a local UI, define a mission, follow one safe next action at a time, and close review, delivery, release, and learning with durable evidence and no surprise upstream writes.

## Stage model
| Stage | Guided intent | Runtime-owned evidence | Owning follow-up slice |
|---|---|---|---|
| First run | Discover `doctor`, `onboard`, `mission create`, `next`, and `app` entrypoints. | CLI help/catalog, environment readiness report. | W21-S02 |
| Doctor | Report local prerequisites, installed command availability, runtime root policy, and actionable blockers. | Read-only CLI output and optional readiness report. | W21-S02 |
| Onboard | Prepare or inspect a target repo with explicit asset mode and project-profile registry roots. | Project profile, project-analysis report, onboarding report. | W21-S03 |
| Mission intake | Capture goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode. | `intake-request-body` and artifact packet evidence. | W21-S04 |
| Next action | Resolve exactly one recommended action for the current state, plus blockers and evidence refs. | Deterministic next-action report over runtime packets, reports, policies, and run state. | W21-S04 |
| Local app | Launch the packaged flow-centric local web console without taking orchestration ownership. | Same-origin SPA config, flow projections, control-plane read models, lifecycle mutations, live events, and UI lifecycle state. | W31-S01, W34-S03 |
| Operator request | Ask AOR to analyze, explain, revise, repair, validate, plan, implement, or review bounded artifacts from any flow stage. | `operator-request`, compiled-context, step-result, proposal/patch refs, next-action report. | W32-S01 |
| Execute | Run bounded work only after validation, policy, handoff, approval, and writeback preconditions are explicit. | Step results, live-run events, run-control audit, Runtime Harness report. | W21-S05 |
| Review and QA | Expose verdicts, holds, approval, repair requests, and missing evidence as durable artifacts. | Review report, review decision, Runtime Harness report, eval reports. | W21-S06 |
| Delivery and release | Prepare delivery and release evidence only under explicit delivery mode and review gates. | Delivery plan, delivery manifest, release packet, writeback result. | W21-S06 |
| Learning closure | Preserve scorecard and follow-up handoff with incident, monitoring, and recertification links. | Learning-loop scorecard, learning-loop handoff, incident reports, finance monitoring snapshot. | W21-S06 |
| Guided proof | Rehearse the installed-user journey on a clean repo with no upstream-write defaults. | `installed-user-guided-journey.yaml`, CLI transcript files, app smoke guardrail from `aor app --smoke`, browser-task evidence refs, flow-loop proof, guided proof summary, no-write assertions. | W21-S07, W34-S06 |

## Guided command vocabulary
These public commands are the installed-user vocabulary. W21-S02 implements the first-run guided shell for `doctor`, `onboard`, `app`, and the initial `next` shell. W21-S03 adds clean bundled onboarding evidence, W21-S04 adds guided mission intake plus deterministic next-action reports, and W31-S01 makes `aor app` a real local app launcher for the first mission intake flow.

| Guided command | Intent | Low-level ownership |
|---|---|---|
| `aor doctor` | Read environment and repo readiness before mutation. | `project init`, project profile resolution, runtime-root checks. |
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

The current implemented flow-centric console design reference is
`docs/product/03-flow-centric-console-design.md`. W34 promotes and implements
that baseline as the local app target: flow selector, active/completed flow
boundaries, `New Flow`, closure-to-follow-up behavior, flow-scoped evidence
views, flow-targeted Ask AOR, and browser-task installed-user proof coverage with
post-run UI/UX quality assessment when UI/UX quality is claimed.

The adopted W63 target successor is
`docs/product/05-quiet-cockpit-console-design.md`. It keeps the same
runtime-owned Project/Flow boundaries while defining Quiet Cockpit as the
eventual default shell and adding flow-scoped Attention, Journey, and Evidence
modes. W63 implements and accepts that experience behind an explicit selector;
W65 owns default-on cutover, rollback, and legacy removal. The reference screens
are future target-state illustrations; they are not current package or
release-readiness claims.

The planned project-topology and detailed-task extension is defined in
`docs/product/04-project-topology-and-task-planning-ux.md`. W60-W62 preserve the
Flow lifecycle boundary while adding Project Structure, a Flow Plan workbench,
parent/child execution visibility, integration recovery, and coordinated
delivery. Quiet Cockpit presents those Plan and Execution surfaces through the
specialist Journey mode, with accessible list/table alternatives to graph
views. These are planned surfaces and must not be described as implemented
until their owning slices close.

A flow is a runtime/control-plane projection over mission/intake, next-action,
operator-request, run, review, delivery, release, and learning evidence.
Active flows can invoke runtime-owned lifecycle mutations. Completed flows are
read-only evidence chains. `New Flow` creates fresh mission/intake evidence and
refreshes `next`; follow-up flows may cite a completed learning handoff without
mutating the completed source flow.

W31-S01 adds the installed-package local app mode, and W36 turns it into the
primary no-settings UI onboarding path:
- `aor app --project-ref <repo>` starts a foreground loopback server and opens the packaged SPA by default;
- `cd <repo> && aor app` is the primary installed-user quickstart; `doctor` and `onboard` remain advanced/headless shortcuts;
- `/` serves the SPA, `/app-config.json` returns `project_id`, `default_project_id`, `projects[]`, `project_ref`, `runtime_root`, package version, API base, and control-plane metadata;
- `GET /api/projects` returns explicit local project summaries without scanning the filesystem or initializing `.aor/`;
- `/api/projects/:projectId/**` remains the control-plane route family used by CLI/API/headless flows;
- `aor app --smoke true --open false --json` validates the real SPA, config, project index, state routes, first-run wizard marker, project switcher marker, flow selector marker, and `New Flow` marker for release and internal maintainer guardrail evidence;
- if onboarding has not run yet, the wizard shows Project Context, Runtime Readiness, First Flow, and Next Action steps instead of silently creating mission evidence.

The optional web console keeps the seven guided stages, but W34 scopes them to
the selected flow:
- readiness;
- mission;
- discovery/spec/plan;
- execution;
- review/QA;
- delivery/release;
- learning.

Each flow-scoped stage exposes durable evidence refs, blocker codes,
selected-run policy history counts, event/log counts, and the exact current
next action from the latest `next-action-report`. Connected mode invokes
`mission create`, `next`, and other bounded lifecycle commands through
`POST /api/projects/:projectId/lifecycle-command/actions`; read-only mode keeps
the same evidence visible while disabling mutation descriptors.

The Mission form uses a safe walkthrough template for the first run. The template does not change packet schemas; it only fills existing intake fields: title, brief, goal, constraint, KPI, Definition of Done, and `delivery-mode=no-write`. Submitting the form sends `command: "mission create"` and then invokes `next` so the UI can immediately refresh the right rail with the current next action, blockers, evidence refs, and runtime root.

Each selected flow stage exposes an Ask AOR action. The request drawer captures
intent, target refs, allowed paths, delivery mode, `target_flow_id`, and a
preview of what runtime will do. Submitting creates an `operator-request`, runs
it through a selected target step, and refreshes evidence. The Evidence Graph,
Runtime Trace, and Evidence & Documents workbench stay scoped to the selected
flow; refs can be attached as request targets. The Interactions Inbox remains
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
- runtime output under `.aor/`, with no runtime state committed by default;
- headless CLI/API operation remains valid when the local app is absent, stopped, or detached;
- production monitoring, offline certification, rehearsal proof, and delivery evidence stay separate.

Risky actions must point to the exact missing approval, handoff, review, promotion, policy, or writeback evidence instead of silently falling through to a weaker path.

## Contract map
W21 adds guided UX by composing existing contract families and a small set of additive fields. The minimum contract ownership is:

| Contract area | Current source of truth | W21 additive ownership |
|---|---|---|
| Project identity and registry roots | `project-profile` | W21-S03 adds explicit `asset_mode` semantics and bundled/materialized registry-root resolution. |
| Bootstrap readiness | `project-analysis-report`, `validation-report` | W21-S03 adds an onboarding report that records readiness, blockers, asset mode, next action, and no-surprise-write evidence. |
| Product mission | `intake-request-body` | W21-S04 preserves goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode. |
| Next action | `next-action-report` | W21-S04 resolves one primary action with blockers, evidence refs, mission state, active run state, and explicit write-back policy; W21-S06 adds `closure_state` for review, delivery, release, and learning. |
| Web lifecycle | `control-plane-api`, `live-run-event` | W21-S05 maps guided stages to read models and lifecycle mutations without UI-owned orchestration; W31-S01 adds the packaged local SPA launcher and app-config route; W34-S03 makes the packaged SPA flow-first. |
| Operator intervention | `operator-request`, `compiled-context-artifact`, `step-result` | W32-S01 adds runtime-owned Ask AOR/request flow across CLI, API, and web without creating a chat-only bypass; W34-S04 scopes requests to selected flow evidence and `target_flow_id`. |
| Closure | `next-action-report`, `review-decision`, `delivery-plan`, `delivery-manifest`, `release-packet`, `learning-loop-handoff` | W21-S06 exposes final-stage decisions, blockers, evidence refs, and exact next actions consistently across CLI/API/web. |
| Flow projection | `control-plane-api`, `intake-request-body`, `next-action-report`, `operator-request`, closure artifacts | W34-S01 defines active/completed flow semantics; W34-S02 implements runtime/control-plane flow list/detail/selected reads, `New Flow` evidence preservation, and completed-flow read-only request guards without adding UI-owned state; W34-S05 links learning closure to follow-up flow creation. |
| Proof | Internal installed-user proof artifacts and quality assessment reports | W21-S07 proves the clean installed-user journey with first-run CLI transcripts, app smoke evidence, durable closure artifacts, and no-upstream-write assertions; W34-S06 extends it with browser-task proof, first-flow completion, second-flow creation, flow-targeted operator requests, accepted skill-agent decisions, and post-run quality assessment refs. |

## Out of scope for the guided journey contract
- implementing `aor doctor`, `aor onboard`, `aor mission create`, `aor next`, or `aor app`;
- changing low-level command output shapes;
- changing packet schemas for UI-only intake fields;
- making the web UI mandatory;
- promoting OpenCode beyond extended candidate coverage before a future real-runner certification proves it.
