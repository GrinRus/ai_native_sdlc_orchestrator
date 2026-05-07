# Installed-user onboarding journey

## Purpose
This is the source-of-truth journey contract for an installed user who starts with a local repository and wants AOR to guide the full SDLC loop without reading internal implementation docs first.

The journey is additive over the existing runtime-owned commands, control-plane mutations, reports, packets, and read models. It does not replace low-level commands, make the web UI mandatory, or allow UI-owned orchestration.

## User outcome
An installed user can connect a repository, understand readiness, define a mission, follow one safe next action at a time, optionally attach the web console, and close review, delivery, release, and learning with durable evidence and no surprise upstream writes.

## Stage model
| Stage | Guided intent | Runtime-owned evidence | Owning follow-up slice |
|---|---|---|---|
| First run | Discover `doctor`, `onboard`, `mission create`, `next`, and `app` entrypoints. | CLI help/catalog, environment readiness report. | W21-S02 |
| Doctor | Report local prerequisites, installed command availability, runtime root policy, and actionable blockers. | Read-only CLI output and optional readiness report. | W21-S02 |
| Onboard | Prepare or inspect a target repo with explicit asset mode and project-profile registry roots. | Project profile, project-analysis report, onboarding report. | W21-S03 |
| Mission intake | Capture goals, constraints, KPI, Definition of Done, source refs, allowed paths, and delivery mode. | `intake-request-body` and artifact packet evidence. | W21-S04 |
| Next action | Resolve exactly one recommended action for the current state, plus blockers and evidence refs. | Deterministic next-action report over runtime packets, reports, policies, and run state. | W21-S04 |
| Optional app | Attach a web console that mirrors the same guided stages without taking orchestration ownership. | Control-plane read models, lifecycle mutations, live events, and UI lifecycle state. | W21-S05 |
| Execute | Run bounded work only after validation, policy, handoff, approval, and writeback preconditions are explicit. | Step results, live-run events, run-control audit, Runtime Harness report. | W21-S05 |
| Review and QA | Expose verdicts, holds, approval, repair requests, and missing evidence as durable artifacts. | Review report, review decision, Runtime Harness report, eval reports. | W21-S06 |
| Delivery and release | Prepare delivery and release evidence only under explicit delivery mode and review gates. | Delivery plan, delivery manifest, release packet, writeback result. | W21-S06 |
| Learning closure | Preserve scorecard and follow-up handoff with incident, monitoring, and recertification links. | Learning-loop scorecard, learning-loop handoff, incident reports, finance monitoring snapshot. | W21-S06 |
| Guided proof | Rehearse the installed-user journey on a clean repo with no upstream-write defaults. | `installed-user-guided-journey.yaml`, CLI transcript files, web smoke evidence, guided proof summary, no-write assertions. | W21-S07 |

## Guided command vocabulary
These public commands are the target vocabulary for W21. W21-S02 implements the first-run guided shell for `doctor`, `onboard`, `app`, and the initial `next` shell. W21-S03 adds clean bundled onboarding evidence, and W21-S04 adds guided mission intake plus deterministic next-action reports. Later W21 slices deepen web stages and closure.

| Guided command | Intent | Low-level ownership |
|---|---|---|
| `aor doctor` | Read environment and repo readiness before mutation. | `project init`, project profile resolution, runtime-root checks. |
| `aor onboard <repo>` | Prepare or inspect a repository using explicit asset-mode behavior. | Project bootstrap, analysis, validation, project-profile registry roots. |
| `aor mission create` | Capture product mission evidence in one guided intake flow. | `intake-request-body` packet evidence with goals, constraints, KPI/DoD, source refs, allowed paths, and delivery mode. |
| `aor next` | Recommend one deterministic next action and explain blockers. | `next-action-report` over onboarding reports, intake packets, run-control state, bounded write-back policy, and closure evidence. |
| `aor app` | Point to the optional web surface and connection state. | `ui attach`, `ui detach`, detached control-plane transport, web read models. |

Low-level commands remain stable, scriptable, and machine-readable. Guided commands may default to human-readable output, but they must preserve machine-readable evidence refs whenever the underlying command already exposes them.

## Web state model
The optional web console mirrors the same stages with these states:
- `read_only`: the web surface can inspect runtime evidence but cannot mutate state.
- `disconnected`: the web surface uses module-backed snapshots without a detached transport.
- `connected`: the web surface uses detached HTTP/SSE read and mutation endpoints.
- `detached`: the web surface unsubscribes while CLI/API/headless runtime operation remains available.
- `blocked`: the current stage has explicit blockers, missing evidence, or policy gates.
- `ready`: the current stage has one safe next action.

The web app must not invent separate lifecycle state. It reads control-plane state and invokes runtime-owned mutations.

W21-S05 maps the optional web console to seven guided stage views:
- readiness;
- mission;
- discovery/spec/plan;
- execution;
- review/QA;
- delivery/release;
- learning.

Each stage exposes durable evidence refs, blocker codes, selected-run policy history counts, event/log counts, and the exact current next action from the latest `next-action-report`. Connected mode invokes `mission create`, `next`, and other bounded lifecycle commands through `POST /api/projects/:projectId/lifecycle-command/actions`; read-only mode keeps the same evidence visible while disabling mutation descriptors.

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
- headless CLI/API operation remains valid when web is absent or detached;
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
| Web lifecycle | `control-plane-api`, `live-run-event` | W21-S05 maps guided stages to read models and lifecycle mutations without UI-owned orchestration. |
| Closure | `next-action-report`, `review-decision`, `delivery-plan`, `delivery-manifest`, `release-packet`, `learning-loop-handoff` | W21-S06 exposes final-stage decisions, blockers, evidence refs, and exact next actions consistently across CLI/API/web. |
| Proof | Live E2E profiles and observation reports | W21-S07 proves the clean installed-user journey with first-run CLI transcripts, web smoke evidence, durable closure artifacts, and no-upstream-write assertions. |

## Out of scope for W21-S01
- implementing `aor doctor`, `aor onboard`, `aor mission create`, `aor next`, or `aor app`;
- changing low-level command output shapes;
- changing detached transport routes;
- making the web UI mandatory;
- claiming OpenCode live-baseline certification while W20-S03 remains externally blocked.
