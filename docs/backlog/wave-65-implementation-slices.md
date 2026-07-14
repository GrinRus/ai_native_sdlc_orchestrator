# W65 - Quiet Cockpit installed-console migration and cutover

W65 moves installed users from the W34 flow-centric console to the W63 Quiet
Cockpit experience without changing AOR lifecycle ownership, packet semantics,
or safety policy. It is a cutover wave, not a second implementation wave.

W63 remains the owner of the Quiet Cockpit product implementation, component
system, Mission, Cockpit, Attention, Journey, Evidence, responsive behavior,
and target-state acceptance. W63 must leave the new experience executable under
an explicit reversible selector while the W34 experience remains the installed
default. W65 owns parity proof, reversible activation, default-on cutover,
rollback rehearsal, legacy removal, and post-cutover acceptance.

W64 remains an independent behavior-preserving maintenance lane. W65 does not
depend on W64, and it must not hide public projection changes inside cutover
work. If a W65 finding exposes missing action or read-model data, the change
returns to the owning contract-first W63 slice or is sequenced explicitly with
W64-S03 before shared projection internals are edited.

## Wave objective

The packaged local console opens Quiet Cockpit by default, preserves every
supported W34 user outcome through the same runtime-owned routes and durable
evidence, offers one explicit and tested rollback path during cutover, and then
removes the legacy renderer after executable parity and safety proof pass.

## Entry conditions

- W63-S07 is `done` with Quiet Cockpit executable through an explicit
  presentation selector and the W34 experience still available.
- The W63 scenario catalog, component contracts, action taxonomy, reference
  screens, installed browser matrix, and no-write evidence are reviewable.
- The accepted W59 browser/state/accessibility foundations and W60-W62
  planning, topology, execution, and delivery projections are present through
  W63's transitive dependencies.
- No open W63 P1 finding permits a false action, hidden authoritative state,
  duplicate durable artifact, completed-flow mutation, or silent partial-read
  downgrade.

## Wave exit criteria

- Quiet Cockpit is the packaged installed-console default for first run,
  active work, blocked recovery, and completed-flow inspection.
- Project, Flow, mode, selected lifecycle stage, and selected attention/evidence
  item survive supported navigation and refresh without becoming lifecycle
  state.
- Every legacy user outcome has a mapped Quiet Cockpit destination and passes
  side-effect, evidence-readback, partial-state, keyboard, responsive, and
  no-upstream-write checks.
- Default-on cutover has a tested explicit rollback path; rendering or read
  failures never trigger an unannounced legacy fallback.
- Legacy source, CSS, fixtures, and compatibility branches are removed only
  after the rollback rehearsal and installed-package cutover gate pass.
- The packaged SPA, distribution manifest, product docs, runbooks, story
  coverage, roadmap, and reference evidence all describe the same default.

## Normative reference registry

These references are the comparison set for every W65 review. Reference PNGs
are visual targets, not contracts or proof of implementation.

### Product and UX sources of truth

- [Quiet Cockpit target design](../product/05-quiet-cockpit-console-design.md)
- [Installed-user onboarding journey](../product/02-installed-user-onboarding-journey.md)
- [Current W34 flow-centric baseline](../product/03-flow-centric-console-design.md)
- [Project topology and task-planning UX](../product/04-project-topology-and-task-planning-ux.md)
- [Supported user stories](../product/00-supported-user-stories.md)
- [Machine-checkable story coverage](../product/user-story-coverage-matrix.md)
- [External console benchmark synthesis](../research/07-quiet-cockpit-console-benchmarks.md)

### Quiet Cockpit target screens

- [Guided Mission intake](../product/assets/w63-quiet-cockpit-console/01-guided-mission-intake-desktop.png)
- [Active Quiet Cockpit](../product/assets/w63-quiet-cockpit-console/02-active-quiet-cockpit-desktop.png)
- [Attention queue](../product/assets/w63-quiet-cockpit-console/03-attention-queue-desktop.png)
- [Journey workbench](../product/assets/w63-quiet-cockpit-console/04-journey-workbench-desktop.png)
- [Evidence ledger](../product/assets/w63-quiet-cockpit-console/05-evidence-ledger-desktop.png)
- [Blocked recovery on mobile](../product/assets/w63-quiet-cockpit-console/06-blocked-recovery-mobile.png)

### Current implemented before-state

- [W34 screen set](../product/assets/w34-flow-centric-console/)
- [W34 implementation plan](wave-34-implementation-slices.md)
- [Current SPA](../../apps/web/src/spa.jsx)
- [Current styles](../../apps/web/src/spa.css)
- [Current Plan workbench](../../apps/web/src/plan-workbench.jsx)
- [Web operator-console tests](../../apps/web/test/operator-console.test.mjs)
- [Web operator-request tests](../../apps/web/test/operator-request-spa.test.mjs)
- [Web Plan workbench tests](../../apps/web/test/plan-workbench.test.mjs)

### Architecture and operating boundaries

- [End-to-end flow](../architecture/08-end-to-end-flow.md)
- [Realtime operations and live view](../architecture/09-realtime-operations-and-live-view.md)
- [CLI and operator flow](../architecture/11-cli-and-operator-flow.md)
- [Orchestrator operating model](../architecture/12-orchestrator-operating-model.md)
- [Package and module map](../architecture/13-package-and-module-map.md)
- [Detachable web console ADR](../architecture/adr/0003-alpha-detachable-web-console.md)
- [Packaged local web console ADR](../architecture/adr/0004-alpha-packaged-local-web-console.md)
- [Operator requests ADR](../architecture/adr/0005-operator-requests-runtime-interventions.md)

### Contract and route sources of truth

- [Contract index](../contracts/00-index.md)
- [Control-plane API contract](../contracts/control-plane-api.md)
- [Control-plane OpenAPI](../contracts/control-plane-api.openapi.json)
- [Intake request body](../contracts/intake-request-body.md)
- [Next-action report](../contracts/next-action-report.md)
- [Operator request](../contracts/operator-request.md)
- [Step result](../contracts/step-result.md)
- [Live-run event](../contracts/live-run-event.md)
- [Runtime Harness report](../contracts/runtime-harness-report.md)
- [Review report](../contracts/review-report.md)
- [Review decision](../contracts/review-decision.md)
- [Quality repair request](../contracts/quality-repair-request.md)
- [Wave ticket](../contracts/wave-ticket.md)
- [Handoff packet](../contracts/handoff-packet.md)
- [Execution plan](../contracts/execution-plan.md)
- [Task-progress report](../contracts/task-progress-report.md)
- [Project profile](../contracts/project-profile.md)
- [Multirepo coordination status](../contracts/multirepo-coordination-status.md)
- [Delivery plan](../contracts/delivery-plan.md)
- [Delivery manifest](../contracts/delivery-manifest.md)
- [Release packet](../contracts/release-packet.md)
- [Learning-loop handoff](../contracts/learning-loop-handoff.md)

### Canonical examples

- [Control-plane module surface](../../examples/control-plane-api/module-surface-baseline.yaml)
- [Complete Mission intake](../../examples/packets/intake-request-body.complete.yaml)
- [Incomplete Mission intake](../../examples/packets/intake-request-body.incomplete.yaml)
- [Next-action report](../../examples/reports/next-action-report.sample.yaml)
- [Closure-ready next action](../../examples/reports/next-action-report.closure-ready.yaml)
- [Canonical operator request](../../examples/reports/operator-request.canonical.yaml)
- [Flow-targeted operator request](../../examples/reports/operator-request.flow-target.yaml)
- [Structured wave ticket](../../examples/packets/wave-ticket-structured-medium.yaml)
- [Structured handoff](../../examples/packets/handoff-structured-medium.yaml)
- [Structured execution plan](../../examples/packets/execution-plan-structured-medium.yaml)
- [Structured task progress](../../examples/reports/task-progress-report-structured-medium.yaml)

### Runtime, test, and package boundaries

- [Flow projections](../../packages/orchestrator-core/src/control-plane/flow-projections.mjs)
- [Run-read projections](../../packages/orchestrator-core/src/control-plane/read-run-projections.mjs)
- [HTTP control plane](../../packages/orchestrator-core/src/control-plane/http/)
- [Next-action resolver](../../packages/orchestrator-core/src/next-action.mjs)
- [Operator-request runtime](../../packages/orchestrator-core/src/operator-request.mjs)
- [App launcher and smoke boundary](../../packages/orchestrator-core/src/operator-cli/app-launcher.mjs)
- [API HTTP transport tests](../../apps/api/test/http-transport.test.mjs)
- [API read-surface tests](../../apps/api/test/read-surface.test.mjs)
- [API live-event tests](../../apps/api/test/live-event-stream.test.mjs)
- [Installed-user guided profile](../../scripts/live-e2e/profiles/installed-user-guided-journey.yaml)
- [Web distribution freshness check](../../scripts/web-dist-freshness.mjs)

### Runbooks and planning dependencies

- [Installed-user first run](../ops/installed-user-first-run.md)
- [UI attach/detach](../ops/ui-attach-detach.md)
- [Run-control lifecycle](../ops/run-control-lifecycle.md)
- [Live-run event stream](../ops/live-run-event-stream.md)
- [Structured task-plan lifecycle](../ops/structured-task-plan-lifecycle.md)
- [Review-decision operations](../ops/review-decision-operations.md)
- [Operator policy troubleshooting](../ops/operator-policy-troubleshooting.md)
- [W59 browser and state foundations](wave-59-implementation-slices.md)
- [W60 structured planning](wave-60-implementation-slices.md)
- [W61 project topology](wave-61-implementation-slices.md)
- [W62 repo-aware execution](wave-62-implementation-slices.md)
- [W63 Quiet Cockpit implementation](wave-63-implementation-slices.md)
- [W64 service-boundary hardening](wave-64-implementation-slices.md)

### External interaction benchmarks

- [Linear Inbox](https://linear.app/docs/inbox) for selectable attention work
  and keyboard list/detail navigation.
- [Sentry Issue Details](https://docs.sentry.dev/product/issues/issue-details/)
  for consequence-first summaries and progressive diagnostic detail.
- [GitHub Actions workflow monitoring](https://docs.github.com/en/actions/how-tos/monitor-workflows)
  for live graph, step status, history, and log drill-down separation.
- [Grafana alert state](https://grafana.com/docs/grafana/latest/alerting/monitor-status/view-alert-state/)
  for explicit state, health, instance, history, and detail distinctions.
- [Temporal UI](https://github.com/temporalio/ui) for durable workflow identity
  and execution-history inspection.

## Migration architecture

W65 uses a strangler cutover around one shared runtime boundary:

```text
app bootstrap and same-origin config
  -> presentation experience selector
     -> W34 legacy renderer (temporary rollback only)
     -> Quiet Cockpit renderer
        -> shared project/Flow resource snapshot
        -> shared canonical action adapter
        -> Cockpit | Attention | Journey | Evidence
```

The two renderers may coexist only at the presentation boundary. They must not
have separate API clients, polling/SSE loops, mutation semantics, durable
operation state, evidence stores, or safety decisions.

### Presentation selector contract

During W65 the selected presentation follows this precedence:

1. explicit query override `?console=legacy|quiet-cockpit`;
2. optional additive `app-config.json.console_experience` default;
3. compiled package default.

The selector is non-authoritative presentation state. It may choose a renderer,
but it cannot alter Project, Flow, lifecycle, write-back, policy, or evidence
state. It is never persisted as runtime evidence or used to authorize an
action. `localStorage` must not become the authoritative default.

If `console_experience` is added, S01 updates the control-plane contract,
validation notes, app-config examples, launcher/transport implementation, and
compatibility tests before the SPA consumes it. Older app-config payloads that
omit the field remain valid.

Rendering or data failure must show the relevant partial/error state. The app
must never switch to legacy silently because Quiet Cockpit failed.

## Surface migration map

| W34/current surface | Quiet Cockpit destination | Authoritative owner | Cutover proof |
|---|---|---|---|
| First-run readiness and New Flow | Cockpit Mission intake | onboarding, intake, Flow, and next-action contracts | complete/incomplete/partial retry packet readback |
| Active-flow cockpit and primary CTA | Quiet Cockpit | next-action, run health, interaction/review/repair contracts | action label-to-side-effect assertion |
| Right-rail blockers, interactions, decisions, and repair | Attention | flow-scoped deterministic read projections | multi-item identity, order, draft, and durable completion |
| Stage rail, Plan workbench, execution views | Journey | W60-W62 plan, topology, scheduler, and delivery projections | lifecycle/task/run/list parity and partial-child truth |
| Evidence/Documents, Graph, Trace, Activity | Evidence | existing flow refs and artifact/decision projections | selected-Flow lineage, read-only closure, raw-ref disclosure |
| Ask AOR drawer | Contextual action from every mode | operator-request contract and mutation routes | resumable create/run/readback without duplicate request |
| Completed-flow closure and New Flow | read-only Cockpit/Evidence plus fresh Mission | closure state, learning handoff, fresh intake | source Flow unchanged and new Flow refs distinct |
| Project, Flow, connection, safety, runtime context | shared Context Bar | app config, project/Flow reads, live state | survives viewport, refresh, and presentation switch |

## Cutover gates and rollback policy

| Gate | Default | Legacy availability | Required evidence |
|---|---|---|---|
| G0: W63 accepted | legacy | explicit Quiet Cockpit selector | W63 installed browser matrix and reference comparisons |
| G1: dual-surface parity | legacy | both explicit | route/action/state parity matrix; no split clients or mutations |
| G2: mode pilots | legacy | both explicit | Mission/Cockpit and specialist-mode pilot evidence |
| G3: default-on | Quiet Cockpit | explicit `?console=legacy` rollback | packaged app smoke, default resolution, browser/a11y/no-write matrix |
| G4: rollback rehearsal | Quiet Cockpit | explicit rollback exercised | deterministic switch/readback/recovery transcript |
| G5: retirement | Quiet Cockpit | removed; legacy query gets a bounded notice | dead-code/CSS/fixture report and post-removal package proof |

Rollback changes presentation only. It does not roll back packets, reports,
runs, Flow selection, or evidence. Before G5, an operator explicitly reloads
with `?console=legacy`; no automatic fallback is allowed. After G5, rollback is
package-version rollback under existing release operations, not a hidden second
runtime inside the current package.

## Comparison evidence matrix

Every cutover review records:

| Field | Requirement |
|---|---|
| Scenario | Stable W63 scenario ID and user job. |
| Current baseline | W34 screenshot, DOM behavior, route set, and observed side effect. |
| Target reference | One or more Quiet Cockpit PNGs plus the relevant product-design section. |
| Contract truth | Packet/report/projection and exact read or mutation route. |
| Implemented evidence | Current rendered screenshot, DOM/accessibility tree, browser trace, and durable readback. |
| Viewports | At minimum 390x844, 768x1024, 1024x768, and 1440x900 where applicable. |
| States | loading, ready, empty, partial, stale, offline, permission, blocked, error, active, and completed where applicable. |
| Safety | write-back mode, authorization result, completed-flow immutability, and no-upstream-write assertion. |
| Verdict | pass, finding, or blocked with owner and evidence ref. |

Visual similarity alone cannot produce a pass.

---

## W65-S01 — Cutover contract, parity baseline, and migration ledger

- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Outcome:** The current W34 and accepted W63 experiences have one
  reviewable route/action/state parity matrix, selector contract, cutover
  ledger, and rollback policy before the installed default can change.
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** product/contract docs, app-config examples and transport
  when required, W63 scenario artifacts, web/API fixtures, backlog/runbooks
- **Hard dependencies:** W63-S07
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-10, OPS-11.

### Local tasks

1. **Freeze the accepted before/after boundary.**
   - Purpose: prevent cutover work from redefining the W34 baseline or the W63
     target after implementation evidence was accepted.
   - Changes: enumerate current screens, Quiet Cockpit modes, scenario IDs,
     route families, visible controls, action side effects, evidence outputs,
     and known limitations; link every row to the normative reference registry.
   - Validation: reviewers can reproduce each baseline scenario from a named
     fixture without credentials, external network access, or committed `.aor/`.
2. **Create route, action, and state parity matrices.**
   - Purpose: prove that migration preserves outcomes rather than matching only
     screenshots.
   - Changes: map each W34 outcome to a Quiet Cockpit destination, contract,
     read route, mutation route, loading/partial/error behavior, and durable
     result; classify intentional removals and presentation-only differences.
   - Validation: every legacy control is preserved, deliberately replaced, or
     explicitly retired with no unmatched mutation or evidence path.
3. **Define the reversible selector contract first.**
   - Purpose: make rollout and rollback explicit without creating browser-owned
     orchestration state.
   - Changes: document query override, optional app-config field, precedence,
     defaults by gate, invalid-value behavior, and old-payload compatibility;
     update contract docs/examples/tests before implementation if the app-config
     shape changes.
   - Validation: old config loads, invalid selectors fail to the documented
     presentation default, and selector choice changes no API response or
     mutation payload.
4. **Open the cutover finding ledger.**
   - Purpose: stop P1 product/safety gaps from being lost inside visual review.
   - Changes: track scenario, severity, owner, contract/code surface, evidence,
     disposition, and whether the finding blocks pilot, default-on, or removal.
   - Validation: no unresolved P1 item can be waived by a screenshot-only pass.
5. **Record W64 coordination boundaries.**
   - Purpose: avoid concurrent edits to next-action and run-read internals under
     two waves.
   - Changes: declare W65 presentation/config-only ownership; redirect missing
     projection semantics to the owning W63 contract slice or sequence them
     explicitly with W64-S03.
   - Validation: the W65 diff contains no unreviewed behavior change to public
     action, blocker, ordering, pagination, isolation, or certification output.

### Acceptance criteria

1. Every supported W34 user outcome maps to one Quiet Cockpit destination,
   authoritative contract, route/action, and durable success or recovery signal.
2. The parity matrix covers loading, empty, partial, stale, offline,
   permission, blocked, error, active, and completed states where applicable.
3. The selector is explicitly non-authoritative and backward-compatible; any
   app-config change landed contract, example, implementation, and test updates
   in that order.
4. No P1 finding is open for false actions, hidden blockers, duplicate durable
   artifacts, unsafe fallback, cross-Flow leakage, or completed-flow mutation.
5. W64 overlap is documented without adding an artificial hard dependency or
   hiding a public behavior change inside cutover work.

### Done evidence

- route/action/state parity matrices
- selector and compatibility contract
- cutover finding ledger
- reproducible before/after fixture index
- W64 non-overlap note

### Out of scope

- Changing the installed default.
- Reimplementing W63 components or product flows.
- Removing legacy source or fixtures.

## W65-S02 — Reversible experience selector and navigation compatibility

- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Outcome:** One shared app bootstrap can render legacy or Quiet Cockpit
  explicitly, preserve presentation navigation and selected runtime context,
  and switch experiences without duplicating clients, mutations, or evidence.
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** `apps/web/src/**`, app-config transport when required,
  web/API tests, package smoke and distribution assets
- **Hard dependencies:** W65-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks

1. Implement the selector precedence from S01 with legacy as the compiled and
   installed default; retain an explicit Quiet Cockpit query path.
2. Keep one generation-keyed Project/Flow resource snapshot, one live-update
   path, and one canonical mutation adapter outside both renderers; prevent a
   presentation switch from issuing duplicate mutations or mixing stale
   project responses.
3. Define a URL presentation descriptor for supported `mode`, inspected stage,
   and selected attention/evidence item; ignore or normalize invalid values
   without changing runtime state.
4. Preserve Project, Flow, connection/safety, and completed-read-only context
   across refresh, browser back/forward, explicit presentation switch, and
   narrow viewports.
5. Make partial/offline/permission failures visible per resource. Do not turn a
   failed read into a healthy empty list and do not silently fall back to the
   other renderer.
6. Build and exercise both renderers from the packaged assets; update the
   distribution manifest and add selector/default/deep-link smoke fixtures.

### Acceptance criteria

1. `legacy`, `quiet-cockpit`, omitted, and invalid selector cases resolve to
   the documented experience at each rollout gate.
2. Switching presentation changes no Project/Flow lifecycle state, packet,
   report, run, action payload, authorization result, or evidence ref.
3. One browser session cannot create duplicate polling/SSE subscriptions or
   mutations because both renderers exist in the bundle.
4. Supported presentation navigation survives refresh and browser history;
   invalid or stale selected items recover to a labelled parent view.
5. Read failures remain partial/offline/permission/error states and never cause
   an unannounced legacy fallback.
6. Packaged source and distribution freshness checks pass for both renderers.

### Done evidence

- selector resolution and compatibility fixtures
- shared client/snapshot/action ownership map
- refresh/back-forward/presentation-switch browser traces
- partial-state and no-silent-fallback fixtures
- updated packaged web distribution manifest

### Out of scope

- Persisting lifecycle or safety state in the URL or local storage.
- Introducing React Router solely for cutover.
- Default-on activation or legacy deletion.

## W65-S03 — Mission and Quiet Cockpit pilot activation

- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **State:** blocked
- **Outcome:** Opt-in installed users can complete first run, Mission creation,
  active work, blocked recovery, completed inspection, and follow-up creation
  entirely through Quiet Cockpit with parity to accepted W34 outcomes.
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** Quiet Cockpit Mission/Cockpit features, shared action
  adapter, web/API/browser fixtures and durable readback evidence
- **Hard dependencies:** W65-S02
- **Primary user story surfaces:** PSO-01, PSO-02, PSO-07, PBO-05, PBO-09,
  OPS-01, OPS-04, OPS-11.

### Local tasks

1. Run complete, incomplete, invalid, partial `mission create -> next`, retry,
   duplicate/follow-up, and completed-source scenarios through the explicit
   Quiet Cockpit selector.
2. Exercise every primary action category—mutation, workbench open, evidence
   inspect, copy, refresh, and unavailable—and compare the observed side effect
   and durable result with the W65 parity matrix.
3. Prove active provider, interaction, decision, failed verification, repair,
   exhausted repair, review, delivery, completed, partial-read, and offline
   Cockpit states without terminal-only ambiguity.
4. Switch each scenario between Quiet Cockpit and legacy after read state is
   materialized; confirm both views point to the same Project, Flow, run,
   blocker, action, and evidence identity.
5. Capture desktop/mobile, keyboard, accessibility-tree, network, and durable
   packet/report evidence against the Mission, active Cockpit, and mobile
   recovery target references.

### Acceptance criteria

1. Mission and Cockpit pilot scenarios complete through canonical routes and
   produce the same durable outcomes as the accepted W34 path.
2. Partial Mission or Ask AOR operations resume from created refs and cannot
   duplicate Mission, request, or next-action evidence on retry.
3. Every visible primary action performs the named effect or explicitly says
   that it opens, inspects, copies, refreshes, or is unavailable.
4. Completed source Flows stay read-only; follow-up creation produces fresh
   Flow and intake refs with explicit lineage.
5. Project, Flow, safety, connection, blocker, and evidence identity are stable
   across presentation switches and responsive layouts.
6. Pilot evidence contains no target-source or upstream write in no-write mode.

### Done evidence

- Mission and Cockpit pilot scenario matrix
- action side-effect and durable readback report
- presentation-switch identity assertions
- desktop/mobile/a11y reference comparisons
- no-duplicate and no-upstream-write evidence

### Out of scope

- Enabling Quiet Cockpit by default.
- Specialist-mode cutover.
- Adding new lifecycle actions for parity convenience.

## W65-S04 — Attention, Journey, and Evidence pilot activation

- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-6
- **State:** blocked
- **Outcome:** Opt-in operators can process all pending work, inspect plan and
  execution progress, and audit selected-Flow evidence through the three
  specialist modes without losing W34 workbench outcomes or runtime truth.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** Quiet Cockpit specialist modes, accepted W60-W62
  projections, evidence/trace reads, browser fixtures and comparison evidence
- **Hard dependencies:** W65-S02
- **Primary user story surfaces:** EMP-01, EMP-02, EMP-03, ARC-05, OPS-01,
  OPS-02, OPS-03, OPS-04, OPS-10, RQA-01, RQA-02, RQA-06, FIN-03, FIN-04.

### Local tasks

1. Exercise Attention with two or more interactions, decisions, verification
   failures, repair states, partial/offline reads, and resolved items; preserve
   stable identity, ordering, independent drafts, source refs, and readback.
2. Exercise Journey at lifecycle, task/execution, and evidence depths using the
   accepted W60-W62 Plan, task progress, topology, scheduler, integration,
   repair, and delivery projections; retain a list/table alternative to graphs.
3. Exercise Evidence across packet/artifact summaries, Graph, Trace, decisions,
   review/repair/Harness/delivery/release/learning lineage, and completed-flow
   read-only inspection without creating a second evidence store.
4. Map every W34 Interactions, Decisions, Plan, Execution, Evidence/Documents,
   Graph, Trace, Activity, and closure outcome to a specialist-mode destination
   and verify the same selected-Flow boundary.
5. Capture keyboard, focus, zoom/reflow, reduced-motion, partial-resource, raw
   ref disclosure, and mobile recovery evidence against the three specialist
   target screens.
6. Reject browser-only snooze, transient completion, aggregate false success,
   or local Activity state as a replacement for durable control-plane truth.

### Acceptance criteria

1. Every actionable Attention item has stable identity, consequence, owner
   stage, source refs, required action, and durable resolution readback.
2. Journey never reports aggregate success while a required task, repository,
   integration, verification, or delivery child remains partial or failed.
3. Journey offers an accessible list/table path before graph-only polish and
   preserves Project/Flow/task/run identity across depth changes.
4. Evidence stays a projection over existing lineage, keeps completed Flows
   read-only, and places raw technical refs behind labelled disclosure.
5. All W34 workbench outcomes are mapped, intentionally retired, or recorded
   as blocking findings; none disappears because its former rail was removed.
6. Specialist modes retain authoritative state at supported viewports and make
   partial/offline/permission failures distinguishable from empty data.

### Done evidence

- Attention multi-item pilot matrix
- Journey lifecycle/task/run/list parity report
- Evidence lineage and completed-read-only report
- W34 workbench-to-mode mapping
- specialist-mode desktop/mobile/a11y comparisons

### Out of scope

- Organization-wide attention across independent projects.
- A new evidence packet, case-file store, or browser-only activity ledger.
- Portfolio planning or hosted collaboration.

## W65-S05 — Default-on cutover and explicit rollback rehearsal

- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Outcome:** The packaged app resolves to Quiet Cockpit by default, retains
  one explicit temporary legacy override, and proves deterministic rollback
  without changing runtime or evidence state.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** app-config/default resolution, packaged web assets,
  browser and installed-app proof, cutover runbook and finding ledger
- **Hard dependencies:** W65-S03, W65-S04
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-06, OPS-10,
  SEC-02, SEC-04.

### Local tasks

1. Resolve omitted selectors to `quiet-cockpit` in the packaged app while
   retaining explicit `?console=legacy` for the rollback window.
2. Run default first-run, active, attention, Journey, Evidence, blocked,
   completed, follow-up, partial-read, permission, and offline scenarios from
   clean browser state without an opt-in parameter.
3. Rehearse rollback from each high-risk state by switching presentation,
   reading back the same Project/Flow/run/action/evidence identity, then
   returning to Quiet Cockpit without duplicate mutation or stale state.
4. Fail cutover on uncaught console errors, external requests, hidden
   authoritative state, unexpected horizontal overflow, stale cross-project
   data, action mismatch, duplicate durable artifacts, or silent fallback.
5. Update the operator cutover runbook with selector precedence, explicit
   rollback steps, stop conditions, retained evidence, and the G5 removal gate.
6. Build the packaged assets first, then run web/API/core focused suites,
   installed app smoke, accessibility/browser proof, root gates, and
   distribution freshness checks.

### Acceptance criteria

1. A clean installed launch with no selector opens Quiet Cockpit for every
   supported Project/Flow state.
2. The explicit legacy override works during this slice and changes only
   presentation; all authoritative refs and safety decisions remain identical.
3. Returning from legacy to Quiet Cockpit cannot repeat a completed mutation,
   lose an unresolved item, or convert a partial/error resource into empty data.
4. Default-on browser, keyboard, responsive, accessibility, package, and
   no-upstream-write matrices pass with no unresolved P1 finding.
5. No renderer failure or read error triggers automatic legacy fallback.
6. The cutover runbook gives an operator a bounded, auditable rollback path and
   names the exact evidence required before legacy removal may start.

### Done evidence

- default-resolution and clean-launch proof
- default-on scenario/browser/accessibility matrix
- explicit rollback rehearsal transcript and identity readback
- updated cutover finding ledger with no open P1 item
- packaged app and distribution freshness evidence
- cutover/rollback runbook

### Out of scope

- Deleting legacy code in the same slice as the default flip.
- Publishing a package or release.
- Automatic fallback or runtime-state rollback.

## W65-S06 — Legacy console retirement and compatibility cleanup

- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Outcome:** The packaged app contains one operator-console renderer, while
  historical W34 product evidence remains documented and unsupported legacy
  selectors fail or redirect transparently without reviving old runtime logic.
- **Delivery priority:** P2
- **Estimated effort:** M
- **Primary modules:** `apps/web/src/**`, `apps/web/test/**`, packaged assets,
  app-config compatibility, source/docs dead-reference checks
- **Hard dependencies:** W65-S05
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks

1. Remove the W34 renderer, presentation switch branch, legacy-only component
   state, duplicate helpers, CSS selectors, snapshot fixtures, and bundle
   markers while retaining shared runtime clients and canonical mutations.
2. Remove the temporary legacy app-config option and document omitted/old field
   compatibility; an old `?console=legacy` link must show a bounded notice and
   land on the equivalent Quiet Cockpit context rather than a blank page.
3. Preserve useful W34 scenario intent by converting remaining acceptance rows
   to Quiet Cockpit fixtures; do not delete historical product screenshots or
   claim that they are current implementation.
4. Run dead-code, unused selector/token, duplicate helper, undefined token,
   source marker, bundle size, and production-file complexity checks under the
   W59 quality ratchet.
5. Rebuild `apps/web/dist/**`, refresh its manifest, and prove the package no
   longer contains or selects the legacy renderer.
6. Update architecture, product baseline/successor notes, runbooks, and package
   guidance to describe one installed renderer without changing headless or
   detachable-console boundaries.

### Acceptance criteria

1. No reachable source, config, fixture, or bundle branch renders the W34
   console, and no duplicate API client or action adapter remains.
2. Old/omitted selector payloads remain safe; `?console=legacy` produces a clear
   compatibility notice and preserves the intended Project/Flow context.
3. W34 design/screens remain available as historical before-state evidence and
   are not presented as current package screenshots.
4. Dead-code, CSS/token, duplication, complexity, bundle, and distribution
   freshness checks pass without weakening W59 limits.
5. CLI/API/headless behavior, loopback/same-origin transport, no-write defaults,
   completed-flow immutability, and durable evidence shapes are unchanged.
6. A package-version rollback remains the documented post-retirement recovery
   boundary; no hidden legacy runtime is shipped.

### Done evidence

- removed legacy source/CSS/fixture inventory
- selector compatibility and old-link browser fixtures
- before/after code, CSS, duplication, complexity, and bundle report
- rebuilt single-renderer distribution manifest
- updated architecture/product/runbook compatibility notes

### Out of scope

- Deleting historical W34 product documents or reference images.
- Replacing React/Vite or adding a UI framework.
- Changing control-plane lifecycle or evidence semantics.

## W65-S07 — Post-cutover installed-console acceptance and story closure

- **Epic:** EPIC-0, EPIC-6, EPIC-7
- **State:** blocked
- **Outcome:** One clean installed-package proof demonstrates that the
  single-renderer Quiet Cockpit default preserves target user outcomes,
  accessibility, responsive behavior, durable evidence, and public-repo safety
  after legacy removal.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** installed SPA/browser suite, guided proof profile,
  package smoke, UX quality report, product/story/readiness/runbook docs
- **Hard dependencies:** W65-S06
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-02, OPS-04, OPS-06,
  OPS-10, OPS-11, RQA-01, RQA-02, RQA-06, FIN-03, FIN-04.

### Local tasks

1. Run the built/installed single-renderer SPA through the complete W63/W65
   scenario catalog at declared desktop, tablet, mobile, zoom/reflow,
   reduced-motion, and keyboard-only profiles.
2. Produce the final comparison matrix linking W34 before-state, Quiet Cockpit
   reference, authoritative contract/route, implemented screenshot, DOM/a11y
   tree, browser trace, durable readback, and verdict for every target job.
3. Rehearse clean first Flow, active provider, multiple Attention items,
   planning/execution Journey, evidence inspection, failed verification/repair,
   completed closure, and follow-up creation with explicit no-target-source and
   no-upstream-write assertions.
4. Verify package distribution, app-config compatibility, same-origin routes,
   live update/reconnect behavior, completed-flow immutability, secret-safe
   rendering, and absence of legacy bundle markers.
5. Produce a final cutover quality report and finding disposition; retain
   explicit gaps for hosted web, collaboration, Windows, credentialed provider
   breadth, and real upstream writes.
6. Update product, architecture, story coverage, README, roadmap, and operator
   docs only after the executable acceptance matrix passes; do not advance
   story or readiness status from design references alone.
7. Run focused tests, `pnpm web:build`, `pnpm lint`, `pnpm test`, `pnpm build`,
   `pnpm check`, and `pnpm slice:gate`, retaining command evidence.

### Acceptance criteria

1. Every required scenario passes from a clean installed package with Quiet
   Cockpit as the only renderer and no legacy selector required.
2. Mission, one safe action, multiple Attention items, Journey progress,
   Evidence inspection, recovery, completed read-only state, and follow-up Flow
   are understandable and executable without editing raw runtime JSON.
3. Automated and manual accessibility evidence has no unresolved P1 issue;
   focus, names, roles, state, contrast, target size, zoom/reflow, and reduced
   motion meet the accepted contracts.
4. Durable evidence proves no duplicate Mission/request/decision on retry, no
   cross-Project or cross-Flow leakage, no completed-source mutation, and no
   upstream write in the safe path.
5. Reference comparison confirms hierarchy and behavior without treating pixel
   similarity as runtime, product-quality, or safety proof.
6. Package, root, backlog, story, and runbook sources all describe Quiet
   Cockpit as the installed default and W34 as historical evidence only.

### Done evidence

- installed single-renderer browser and task matrix
- final before/reference/implementation comparison matrix
- accessibility, keyboard, responsive, and reduced-motion report
- safe-flow packet/report and no-write readback
- final cutover quality report and finding ledger
- updated product/story/readiness/operator docs
- focused command results and `pnpm slice:gate`

### Out of scope

- Publishing npm or GitHub releases.
- Hosted web, multi-user collaboration, enterprise identity, or public CORS.
- Credentialed provider matrix expansion or real upstream-write proof.
