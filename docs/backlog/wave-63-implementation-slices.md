# W63 implementation slices

W63 turns the post-audit operator-console UX/UI assessment into a bounded
product-maturity wave. It starts only after W62-S06 proves the structured
planning, topology, and repo-aware delivery flows, so the audit verdict and
new operator capabilities are not evaluated against a moving interface.

W59 remains the owner of executable browser confidence, truthful live state,
queue mechanics, accessible dialog primitives, web-state decomposition, and
code-quality ratchets. W63 reuses those foundations and owns the next layer:
complete task flows, truthful action affordances, cockpit information
architecture, adaptive navigation, reusable visual-system contracts, and
task-based UX/UI proof.

The target outcome is one sentence: an installed local operator can complete a
safe AOR flow, understand and take one truthful next action, recover from
partial or blocked states, and inspect durable evidence on desktop or mobile
without terminal-only ambiguity.

## Contract and compatibility order

W63 remains packet-first, contract-first, headless-first, and local-only.

1. Product and UX source-of-truth changes land before component or styling
   changes.
2. Existing contract owners are reused: `intake-request-body`,
   `next-action-report`, `operator-request`, flow projections, run health,
   interaction answers, and the control-plane API.
3. If a UI action needs data that those contracts do not expose, the owning
   contract, validation notes, canonical examples, and compatibility behavior
   must change before the SPA consumes the new field.
4. No UI-only lifecycle state, packet family, safety decision, or orchestration
   shortcut may be introduced.
5. CLI/API/headless flows, completed-flow immutability, no-upstream-write
   defaults, and the loopback same-origin topology remain compatible.

W63 must not revive legacy `allowed_paths` hints as authoritative Runtime
Harness scope. Mission and action UI consume the canonical scope model closed by
W57 and the control-plane semantics closed by W58/W59.

## W63-S01 — Operator journey, action semantics, and scenario baseline

- **Outcome:** AOR has one accepted operator-console UX contract that names the
  primary users, top jobs, information hierarchy, action semantics, state
  matrix, and deterministic UI scenarios used by every later W63 slice.
- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `apps/web/test/**`, `docs/backlog/**`
- **Hard dependencies:** W62-S06
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-11, RQA-01,
  RQA-02.

### Local tasks

1. Confirm the local console as a full-flow operator surface for the primary
   operator/SRE role and the secondary reviewer/QA role; keep sponsor and
   planner summaries secondary rather than forcing all personas into one
   cockpit.
2. Update the flow-centric console product baseline with the canonical reading
   order `current state -> one safe action -> evidence on demand`, plus clear
   boundaries for navigation, attention, and debug surfaces.
3. Define an action taxonomy for controls that execute a mutation, open an AOR
   workbench, inspect evidence, copy a terminal command, refresh state, or are
   unavailable; visible labels must describe the real effect.
4. Map each UX surface to its owning packet, report, route, mutation, and
   recovery contract, and record any additive contract gap with compatibility
   behavior before implementation starts.
5. Define deterministic scenarios for clean first run, invalid and complete
   Mission intake, active flow, partial multi-step mutation, multiple queued
   interactions/decisions, provider progress, failed verification, repair,
   completed read-only closure, follow-up flow, and partial/offline reads.
6. Add a disposable scenario catalog and fixture-loading convention on top of
   the W59 browser harness without requiring credentials, a live provider, or
   committed `.aor/` state.

### Acceptance criteria

1. The product baseline names primary roles, top jobs, the full-flow console
   boundary, and the three-level information hierarchy without changing
   orchestration ownership.
2. Every interactive control family has one semantic category and a required
   labeling/feedback rule; a copy-only control cannot look like an executed
   mutation.
3. Every scenario records entry state, authoritative evidence, primary action,
   blockers, expected recovery, success signal, and required viewport or
   keyboard coverage.
4. Every proposed field or mutation names its existing contract owner or a
   contract-first change with backward-compatibility notes.
5. The scenario catalog runs through the installed/built SPA on disposable
   loopback state and makes no external network call or upstream write.
6. W59 browser, client, queue, dialog, and quality-ratchet deliverables are
   reused rather than duplicated.

### Done evidence

- updated flow-centric UX/product baseline
- action-semantics and state-matrix reference
- contract/route/packet ownership map
- deterministic UI scenario catalog and fixture loader
- scenario-catalog browser smoke

### Out of scope

- Implementing the redesigned Mission, cockpit, workbench, or visual system.
- Hosted UI, accounts, collaboration, SSO, browser token storage, or remote SPA
  connectivity.
- Adding UI-owned orchestration or a parallel packet schema.

## W63-S02 — Semantic design system and component contracts

- **Outcome:** The local console has a small semantic token and component
  contract that can support the W63 journeys without one-off colors, typography,
  cards, statuses, dialogs, or recovery paths.
- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/src/**`, `apps/web/test/**`, UI foundation docs
- **Hard dependencies:** W63-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks

1. Inventory existing CSS variables, raw values, undefined tokens, type rules,
   status mappings, repeated path patterns, and component states against the
   W63 scenario catalog.
2. Define semantic color, typography, spacing, radius, elevation, motion,
   control-size, focus, and data-density tokens with one code source of truth.
3. Define reusable contracts for Button/IconButton, Field, Dialog/Drawer,
   StatusBadge/Count, Alert, Card/Section, EmptyState, Disclosure, Tabs,
   ProgressPath, and table/list action patterns.
4. Give every component explicit default, hover, active, focus-visible,
   disabled, loading, selected, invalid, warning, danger, success, and empty
   behavior where the component can enter that state.
5. Replace arbitrary status-string parsing with explicit semantic tones and
   separate neutral counts from warnings.
6. Establish an operational type scale and density model that keeps repeated
   work scannable without relying on 11px text, synthetic extreme weights, or
   uppercase for ordinary section headings.
7. Add foundation fixtures and accessibility assertions before migrating
   product surfaces incrementally under the W59 complexity/duplication ratchet.

### Acceptance criteria

1. Semantic tokens are the source of truth for migrated UI; raw color values
   appear only in token declarations and no consumed token is undefined.
2. Component contracts name anatomy, usage boundary, variants, responsive
   behavior, keyboard semantics, labels, focus treatment, and state coverage.
3. Text and UI-state contrast meet WCAG AA where applicable, and focus
   indicators maintain at least 3:1 contrast against adjacent surfaces.
4. The type scale distinguishes page title, section heading, body, label,
   status, metric, and code roles; operational numbers use tabular figures.
5. Foundation components pass desktop/mobile, keyboard, reduced-motion, and
   accessibility-tree fixtures.
6. No new UI framework is added and existing installed-package behavior stays
   compatible.

### Done evidence

- semantic token map and consuming CSS variables
- component anatomy/state matrix
- foundation component fixtures and accessibility results
- before/after raw-value, undefined-token, type-scale, and duplication report
- packaged SPA foundation smoke

### Out of scope

- A marketing-site brand redesign or illustration system.
- Replacing React/Vite or adopting a new UI framework.
- Migrating every historical low-value debug surface in one bulk rewrite.

## W63-S03 — Guided Mission intake and resumable first-flow creation

- **Outcome:** An installed user can create a complete Mission or deliberately
  preserve an incomplete Mission through the local UI, understand every
  resulting blocker before mutation, and recover from a partial
  `mission create -> next` sequence without duplicate evidence.
- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `docs/contracts/**`, canonical examples,
  `apps/web/src/**`, control-plane lifecycle responses, browser tests
- **Hard dependencies:** W63-S01, W63-S02
- **Primary user story surfaces:** PSO-01, PSO-02, PBO-09, OPS-11.

### Local tasks

1. Confirm the post-W57 canonical mission-scope contract and update contract
   docs, examples, validation notes, and response compatibility before adding
   any field or operation metadata needed by the UI.
2. Replace the flat Mission form with a structured builder for goals,
   constraints, KPI records, Definition of Done items, local structured source
   refs, delivery mode, and canonical bounded scope.
3. Add visible structural requirements, helper text, inline validation,
   `aria-invalid`/`aria-describedby`, an error summary, and focus movement to the
   first invalid field; a blank or structurally invalid intake must not silently
   materialize a flow.
4. Show live completeness and safety previews for blank, safe walkthrough,
   follow-up, and duplicate settings. Preserve the contract's intentional
   `complete | incomplete` semantics by making incomplete creation an explicit
   acknowledged path that names missing evidence and downstream blockers.
5. Model `mission create` and the following `next` mutation as a resumable
   operation with created refs, pending step, partial-success recovery, and
   idempotent retry behavior.
6. Keep no-write copy precise: AOR may write durable evidence under `.aor/`, but
   must not edit target source files or perform upstream writes.
7. Add browser tests for invalid, complete, partial-success, retry, keyboard,
   mobile, follow-up, and delivery-mode boundary cases.

### Acceptance criteria

1. Empty or structurally invalid intake cannot be submitted. Contract-valid but
   incomplete intake can be preserved only through an explicit action that
   names each missing evidence group and the stages it will block.
2. A complete Mission can provide goals, constraints, structured KPIs, DoD,
   and local source refs without leaving the UI or editing raw JSON.
3. Canonical mission-scope and delivery requirements come from the post-W57
   contract and do not treat legacy path hints as Runtime Harness authority.
4. If `mission create` succeeds and `next` fails, the UI preserves created refs,
   offers only the remaining safe step, and cannot create a duplicate Mission
   on retry.
5. Successful creation ends with a persistent summary containing the new flow,
   Mission/intake refs, next-action status, blockers, and a direct cockpit link.
6. Blank, safe, follow-up, and duplicate paths remain no-upstream-write by
   default and preserve completed-flow immutability.

### Done evidence

- updated contract docs/examples when required
- structured Mission builder and completeness preview
- resumable first-flow operation state
- invalid/valid/partial/retry browser fixtures
- packet/ref readback proving no duplicate evidence

### Out of scope

- Live SaaS intake connectors.
- Replacing `intake-request-body` with a UI-specific Mission schema.
- Automatically starting provider execution after Mission creation.

## W63-S04 — Truthful action-first cockpit and recovery controls

- **Outcome:** The active-flow cockpit exposes one outcome-named primary action
  whose behavior matches its label, while terminal handoffs, workbench opens,
  refreshes, and copied commands are visibly distinct and auditable.
- **Epic:** EPIC-3, EPIC-4, EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `docs/contracts/**`, next-action and run-health examples,
  control-plane lifecycle mutations, `apps/web/src/**`, browser tests
- **Hard dependencies:** W63-S01, W63-S02
- **Primary user story surfaces:** OPS-01, OPS-04, OPS-11, RQA-02, RQA-06.

### Local tasks

1. Map `next-action-report.primary_action`, run health, quality repair,
   interactions, review decisions, and closure evidence into the W63 action
   taxonomy without inventing a second next-action owner.
2. Add contract-first action metadata only when the existing reports cannot
   deterministically distinguish an executable mutation, workbench action,
   evidence inspection, refresh, or terminal handoff. The SPA must never parse
   a shell command string to decide which mutation to execute.
3. Make supported lifecycle and recovery actions execute through the canonical
   same-origin control-plane mutation; label unsupported paths explicitly as
   `Copy ... command` or `Continue in terminal` and confirm the copy result.
4. Remove or rename false affordances such as controls that say Stop, Retry,
   Diagnose, or Resolve while only copying text or refreshing state.
5. Give each action operation-specific pending, partial, success, blocked, and
   error feedback with `aria-busy`, an accessible live status, durable refs,
   and a safe retry or inspect path.
6. Make Ask AOR `create -> run -> refresh` resumable and keep its result visible
   after the drawer closes; retries must resume the durable request rather than
   create another one.
7. Cover active, provider-running, controller-decision, assessment, verification
   failure, exhausted repair, completed repair, review, delivery, and completed
   read-only action states in the scenario harness.

### Acceptance criteria

1. Every primary control either performs the named mutation, opens the named
   workbench/evidence surface, or explicitly says that it copies a command.
2. The generic `Resolve Next Action` label is replaced by the actual operator
   outcome or a truthful terminal handoff; rerunning `next` is labelled as a
   refresh/resolution operation rather than stage advancement.
3. Partial Mission, Ask AOR, review, and recovery operations preserve durable
   refs and cannot duplicate requests or decisions on retry.
4. Success remains visible with result/evidence refs and one relevant follow-up
   action; errors retain structured HTTP/control-plane recovery context.
5. Completed flows expose inspection and follow-up creation only; no cockpit
   control mutates their evidence chain.
6. Browser tests fail when an action label and observed side effect diverge.

### Done evidence

- action contract/compatibility updates when required
- action-to-control-plane mapping table
- outcome-named cockpit and recovery controls
- resumable Ask AOR and lifecycle operation fixtures
- browser side-effect and readback assertions

### Out of scope

- Automatic execution of arbitrary shell commands from the browser.
- Bypassing approval, review, Runtime Harness, or delivery gates.
- Adding direct chat state outside durable operator requests.

## W63-S05 — Adaptive shell and lifecycle navigation

- **Outcome:** Project, flow, lifecycle stage, connection, safety, and the one
  primary action remain understandable and operable across supported desktop,
  tablet, and mobile widths without hiding authoritative state.
- **Epic:** EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** `apps/web/src/**`, responsive styles, browser fixtures
- **Hard dependencies:** W63-S03, W63-S04
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks

1. Replace the non-interactive compact progress strip with an accessible
   responsive stage selector so active-flow navigation remains available below
   and above the current 1180px breakpoint.
2. Recompose the top bar around project, flow, connection/safety, and utility
   actions; move long runtime paths and secondary technical metadata into
   labelled disclosure or project context.
3. Move right-rail-only blockers, verification, requests, safety, and flow
   inventory into responsive attention/disclosure surfaces instead of removing
   them with `display:none`.
4. Define table, artifact list, timeline, form, drawer, and action-toolbar
   behavior for narrow widths, wrapping, overflow, touch, and safe-area spacing.
5. Align DOM order, visual order, focus order, and the primary action hierarchy;
   preserve contextual focus names and reduced-motion behavior.
6. Add breakpoint regression fixtures at 320px and 390x844, 768x1024,
   1024x768, 1180/1181px, and 1440x900, plus browser reflow/zoom coverage.

### Acceptance criteria

1. A keyboard or touch user can select every lifecycle stage at every supported
   viewport; active stage, selected inspection view, and runtime stage remain
   distinct and announced.
2. Project, selected flow, connection/safety, and the primary action are
   reachable before advanced evidence without horizontal page overflow.
3. No authoritative blocker, pending interaction/decision, verification state,
   latest request, or safety status disappears solely because the viewport is
   narrow.
4. Controls maintain at least 40px desktop and 44px touch targets; text and
   primary actions are not clipped or overlapped.
5. Dense tables use an explicit responsive alternative or labelled local
   overflow rather than shrinking content below readability.
6. Breakpoint, keyboard, focus-order, and overflow browser fixtures pass for
   first-run, active, blocked, and completed scenarios.

### Done evidence

- adaptive shell and stage selector implementation
- responsive state-surface mapping
- desktop/tablet/mobile screenshot and DOM evidence
- keyboard/focus-order and target-size results
- breakpoint regression matrix

### Out of scope

- Native iOS/Android applications.
- Hosted responsive account, tenant, or collaboration surfaces.
- Hiding evidence required for a safe operator decision.

## W63-S06 — Attention queue, evidence workbench, and cockpit hierarchy

- **Outcome:** Operators can scan one current state, handle every pending item,
  and inspect supporting evidence without duplicated next-action, blocker,
  safety, and artifact panels competing for attention.
- **Epic:** EPIC-1, EPIC-4, EPIC-6
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/src/**`, flow projections/read models,
  scenario fixtures, browser tests
- **Hard dependencies:** W63-S03, W63-S04, W63-S05
- **Primary user story surfaces:** OPS-01, OPS-02, OPS-04, OPS-10, OPS-11,
  RQA-01, RQA-02, RQA-06.

### Local tasks

1. Implement the canonical cockpit hierarchy: concise current state, one
   action/blocked recovery region, compact status facts, and evidence on demand.
2. Remove repeated next-action, blocker, safety, and evidence summaries from
   top bar, cockpit, right rail, and lower tables; assign one primary home and
   use links or counts elsewhere.
3. Build one selectable attention queue for partial/offline errors, runtime
   interactions, operator decisions, assessments, verification failures,
   repairs, and other blockers using the W59 queue/state mechanics.
4. Preserve independent drafts, selected IDs, source refs, severity, age,
   owning stage, required action, and durable completion feedback for multiple
   queued items.
5. Keep Evidence/Documents, Execution, Graph, Trace, Interactions, Decisions,
   Activity, and raw refs progressively disclosed and flow-scoped; default
   debug-heavy surfaces closed unless they are the current recovery target.
6. Use human Mission titles plus stage, status, recency, and outcome in flow
   selectors and history; keep technical IDs available for copy/debug.
7. Correct operator microcopy for no-write, patch-only, runtime evidence,
   status severity, version, and technical metrics; remove decorative or fixed
   meters that do not represent real data.

### Acceptance criteria

1. The first cockpit viewport has one visually dominant action or blocked
   recovery path and does not repeat the full next action in another rail.
2. Blockers, safety, evidence, and latest-request facts have one authoritative
   visible home and remain reachable from every applicable viewport.
3. With two or more interactions or decisions, the operator can select and
   complete each item with the correct run/request ref and independent draft.
4. Advanced surfaces remain flow-scoped, completed-flow safe, keyboard
   operable, and collapsed by default unless required for the current action.
5. Human-readable Mission identity is primary in selectors/history while raw
   IDs and paths remain available through labelled debug affordances.
6. No decorative status, meter, warning color, or action label implies state
   that is absent from the runtime/control-plane evidence.

### Done evidence

- before/after cockpit information-architecture map
- attention queue multi-item browser fixtures
- deduplicated shell/workbench component map
- flow selector/history and microcopy review
- desktop/mobile rendered comparison evidence

### Out of scope

- Organization-wide portfolio dashboards across independent AOR projects.
- Replacing durable evidence with transient browser notifications.
- Removing technical inspection paths needed by advanced operators.

## W63-S07 — Installed-console UX/UI acceptance and story closure

- **Outcome:** W63 closes with executable installed-package evidence that the
  local console completes its target operator jobs with acceptable visual,
  responsive, accessibility, recovery, and safety quality.
- **Epic:** EPIC-0, EPIC-6, EPIC-7
- **State:** blocked
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** installed SPA browser suite, package smoke, UX quality
  report, product/story/readiness docs
- **Hard dependencies:** W63-S02, W63-S03, W63-S04, W63-S05, W63-S06
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-02, OPS-04, OPS-10,
  OPS-11, RQA-01, RQA-02, RQA-06.

### Local tasks

1. Run the installed/built SPA against the complete deterministic W63 scenario
   catalog at desktop, tablet, mobile, and keyboard-only profiles.
2. Fail acceptance on uncaught console errors, unexpected external requests,
   stale cross-project state, hidden authoritative state, duplicate durable
   artifacts, action/side-effect mismatch, focus leakage, or horizontal page
   overflow.
3. Run automated accessibility checks plus manual keyboard and accessibility
   tree inspection for landmarks, dialogs, tabs/selectors, forms, attention
   queues, tables, live status, and completed read-only flows.
4. Capture stable rendered evidence for first run, Mission, active cockpit,
   provider progress, interaction/decision, failed verification/repair,
   review/QA, completed closure, follow-up flow, partial read, and offline
   recovery states.
5. Rehearse the safe first-flow and follow-up paths with durable packet/report
   readback and explicit no-target-source/no-upstream-write assertions.
6. Produce a final UX/UI quality report with finding disposition, inspected
   refs, task outcomes, remaining limitations, and scored dimensions that do
   not substitute visual evidence for runtime/product-quality evidence.
7. Update product, architecture, story coverage, roadmap, README, and operator
   guidance only after the executable acceptance matrix passes.

### Acceptance criteria

1. Every required scenario passes the installed-package browser matrix at all
   declared viewports and keyboard-only operation, with actionable retained
   artifacts on failure.
2. Mission creation, one safe next action, multiple attention items, recovery,
   evidence inspection, completed-flow read-only state, and follow-up creation
   are executable and understandable without editing raw runtime JSON.
3. Automated and manual accessibility evidence has no unresolved P1 issue;
   focus, labels, names, roles, state, contrast, target size, and reduced motion
   meet the W63 component and journey contracts.
4. Visual review confirms stable hierarchy, readable operational density,
   responsive information retention, and semantic status use without relying
   on brittle source-marker assertions.
5. Durable evidence proves no duplicate Mission/request on partial retry, no
   target source edit in no-write mode, no upstream write, and no completed-flow
   mutation.
6. Story/readiness claims cite executable evidence for the exact supported
   surface and retain explicit gaps for hosted web, Windows, credentialed
   provider breadth, and real upstream writes.

### Done evidence

- installed SPA task/browser matrix
- accessibility and keyboard report
- responsive/rendered evidence bundle
- safe-flow packet/report and no-write readback
- final UX/UI quality report and finding ledger
- updated product/story/readiness/operator docs
- `pnpm slice:gate`

### Out of scope

- Automatic npm/GitHub release publication.
- Hosted web, multi-user collaboration, enterprise identity, or public CORS.
- Credentialed provider matrix expansion, paid external calls, or real
  upstream-write proof.
