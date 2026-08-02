# W59 implementation slices

W59 turns the remaining operator-surface and maintainability findings into
behavioral gates and bounded refactors after W57/W58 restore trustworthy runtime
semantics. The wave closes the July 2026 audit; it does not automatically publish
a release or broaden the product into hosted web.

The frontend remains local-only. W59 improves correctness, live state,
accessibility, tests, and maintainability. It does not add login, remote bearer
token handling, multi-user authorization, public deployment, or frontend-owned
orchestration.

W59 does not claim broad UX/UI maturity. The post-execution product work for
complete Mission intake, truthful action affordances, cockpit hierarchy,
adaptive lifecycle navigation, semantic design-system contracts, and task-based
UX/UI proof is tracked in W63. W63 starts only after W62-S06 and must reuse the
browser harness, local client/state model, queue mechanics, accessible dialog
primitive, module boundaries, and quality ratchets established here.

Priorities use the audit remediation scale (`P0` release blocker, `P1` next
repair lane, `P2` planned). Effort estimates use `XS/S/M/L/XL` and include
implementation, characterization/regression tests, metrics, and documentation.

Commit `392f94c` landed a provisional W60 structured-planning baseline after the
July audit baseline but before W57-W59 acceptance. W59 quality, clone, browser,
and module baselines must include that code; its presence neither bypasses W60
hard dependencies nor makes any W60 slice done.

## W59-S01 — Executable browser and component behavior gate

- **Outcome:** Web acceptance executes the packaged SPA and asserts user-visible
  behavior instead of treating JSX/bundle marker strings as functional proof.
- **Epic:** EPIC-0, EPIC-6, EPIC-7
- **State:** done
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/test/**`, browser/component harness,
  app package smoke, CI/release tests
- **Hard dependencies:** W58-S08
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-06, OPS-07,
  OPS-11, OPS-12.
- **Audit findings:** AUD-044 and web regression coverage for AUD-019,
  AUD-039 through AUD-043.

### Local tasks
1. Add a supported component/browser test harness that runs the built SPA against
   a disposable loopback target.
2. Cover clean first load, explicit initialization, same-origin mutation,
   cross-process SSE/reconnect, delayed project switching, partial endpoint
   failure, multiple queued items, and modal keyboard behavior.
3. Capture browser console/network failures and fail tests on uncaught errors,
   unhandled rejections, unexpected writes, or unsupported external requests.
4. Keep bundle/source marker checks only as package-presence smoke, not behavior
   certification.
5. Add desktop, tablet, mobile, and keyboard-only fixtures with deterministic
   project/evidence state.
6. Integrate the focused browser gate into CI/release acceptance with bounded
   timeouts and actionable artifacts outside Git; prove tracked `dist` freshness
   through content hashes or a clean temporary rebuild comparison, not filenames
   and source hash alone.
7. Add explicit label-to-mutation and mutation-to-durable-readback oracles for
   current console actions, and cover contextual operator errors, retained
   success results, and selected-project identity across reload and reconnect.

### Acceptance criteria
1. The tests fail when GET/first load creates `.aor`, SSE stops updating, a stale
   project response wins, errors render as empty, a second queue item is
   unreachable, or a modal leaks focus.
2. Browser tests execute the installed/built SPA rather than importing private
   UI implementation helpers only.
3. The test target remains loopback-only and never requires hosted services,
   credentials, or external network access.
4. Failure output identifies the user flow, request, visible state, and retained
   browser/runtime evidence.
5. Marker tests remain explicitly labeled packaging-only.
6. Modifying an existing tracked HTML/JS/CSS bundle file without a matching
   source rebuild fails the package-freshness gate.
7. The gate fails when an action label promises a different side effect from the
   invoked mutation, an operator error is opaque or rendered as healthy empty
   state, a successful result disappears after reload, or a request/readback is
   resolved through the wrong selected-project context.

### Done evidence
- component/browser harness and deterministic fixtures
- clean-first-load and live-state behavior tests
- action-label/mutation/readback, contextual-error, durable-success, and
  selected-project behavior fixtures
- desktop/tablet/mobile/keyboard result matrix
- package-installed SPA smoke
- CI/release gate integration

### Out of scope
- Hosted end-to-end environments.
- Cross-browser cloud grids or paid testing services.
- Visual redesign unrelated to confirmed behavior.

## W59-S02 — Local console live-state and interaction correctness

- **Outcome:** The same-origin local console consumes one durable control-plane
  client, commits project snapshots atomically, exposes partial failures, and lets
  the operator handle every pending interaction/decision with truthful action,
  lifecycle-stage, error, and durable-result presentation.
- **Epic:** EPIC-1, EPIC-6
- **State:** done
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/src/**`, local control-plane client, web fixtures,
  shared read models
- **Hard dependencies:** W59-S01
- **Primary user story surfaces:** ARC-06, PBO-09, EMP-05, OPS-01, OPS-02,
  OPS-04, OPS-10, OPS-11, OPS-12.
- **Audit findings:** AUD-039, AUD-040, AUD-041, AUD-042, AUD-054.

### Local tasks
1. Create one same-origin control-plane client using the supported local config,
   EventSource cursor/reconnect, and bounded polling fallback.
2. Close/abort old streams and requests on project/flow switch and commit one
   generation-keyed project snapshot instead of independent stale setters.
3. Track loading, connected, partial, stale, offline, and per-resource error state
   separately from authoritative empty data; render the W58-S06 error envelope
   as a contextual recovery card without inferring actions from diagnostic text.
4. Preserve last-known state on partial failure and disable decisions that depend
   on missing resources.
5. Add accessible selection and independent draft state for every queued
   interaction and decision rather than fixed `[0]` access.
6. Render package/app-config version and remove stale hard-coded display values.
7. Remove, reserve, or explicitly document unsupported arbitrary-remote UI config
   fields without breaking the headless detached API.
8. Rename the current refresh-only `Resolve Next Action` control to
   `Refresh next action` and `Add local project` to `Add another AOR project` so
   visible labels match their implemented side effects until W61/W63 replace the
   corresponding flows.
9. Persist successful operation results with durable project/flow/run and
   evidence references, restore them after reload/reconnect, and label the
   authoritative `Current lifecycle stage` separately from any `Viewing stage`.

### Acceptance criteria
1. A separate-process event updates the selected local flow without manual refresh
   and reconnect resumes from the durable cursor.
2. Delayed project A responses can never render after project B becomes selected.
3. A 500/offline/partial response is visible by resource and is never presented as
   empty healthy state.
4. Two or more pending interactions/decisions can be selected and completed with
   correct run/request references.
5. UI and package smoke display the same version from app config.
6. The SPA works entirely same-origin and contains no browser credential or remote
   control-plane requirement.
7. Errors appear beside the affected operation with structured consequence,
   retryability, evidence, and supported recovery actions; an opaque diagnostic
   is never the only operator-visible state.
8. `Refresh next action` performs only the next-action refresh, and
   `Add another AOR project` cannot be mistaken for adding a repository to the
   current project.
9. Successful operations retain their durable references across reload and
   reconnect, and the UI never presents the inspected stage as the current
   lifecycle stage.

### Done evidence
- typed/local control-plane client tests
- project generation/abort race fixtures
- partial/offline/error-state browser tests
- contextual recovery-card and diagnostic-text non-inference tests
- truthful action-label and lifecycle/viewing-stage fixtures
- durable operation-result reload/reconnect fixtures
- multi-item interaction/decision tests
- version/config compatibility tests

### Out of scope
- Remote SPA to arbitrary control-plane connectivity.
- Browser bearer token lifecycle, login, OAuth/SSO, RBAC, or tenant switching.
- Frontend-owned runtime decisions.
- Execution Setup and repository-topology editing, which are owned by W61.
- Full Quiet Cockpit and UI-only lifecycle closure, which are owned by W63.

## W59-S03 — Accessible local dialogs and web state decomposition

- **Outcome:** Local console dialogs follow accessible keyboard semantics, and
  state/client/feature boundaries are decomposed behind the W59-S01 behavior gate.
- **Epic:** EPIC-0, EPIC-6
- **State:** done
- **Remediation priority:** P2
- **Estimated effort:** L
- **Primary modules:** `apps/web/src/spa.jsx`, `apps/web/src/spa.css`, extracted
  web modules/components, browser tests
- **Hard dependencies:** W59-S01, W59-S02
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.
- **Audit findings:** AUD-043 and the web portion of AUD-049.

### Local tasks
1. Introduce one reusable labelled dialog/drawer primitive with initial focus,
   contained Tab/Shift+Tab, Escape, inert background, and focus restoration.
2. Apply it to Add Project, request, decision, and other modal-like local flows;
   replace custom radio/tab behavior with native or APG-compliant controls.
3. Extract the control-plane client, project snapshot reducer/hooks, queue state,
   dialog state, Plan workbench, and feature views from the monolithic SPA; include
   all provisional W60 web modules in the characterization baseline.
4. Split touched styles by feature/semantic token while preserving responsive
   behavior and installed package output.
5. Add characterization tests before each move; require extracted functions to
   stay below complexity 20, nesting depth 5, and 101 physical lines, and require
   extracted production files to stay below 1,001 physical lines.
6. Verify screen-reader role/name/state and keyboard behavior on desktop/mobile.

### Acceptance criteria
1. Every modal surface exposes a labelled dialog role, receives initial focus,
   contains forward/reverse Tab, closes with Escape, and restores focus.
2. Background controls cannot receive pointer or keyboard focus while a dialog is
   open.
3. Project/client/queue/dialog state transitions have isolated unit tests and no
   feature view owns orchestration logic.
4. The built SPA preserves all W59-S01 behavior and responsive fixtures.
5. `FlowCockpit`, `App`, and `PlanWorkbench` no longer exceed complexity 19,
   nesting depth 4, or 100 physical lines after extraction; every extracted
   production file stays at or below 1,000 physical lines, with no unbounded
   compatibility facade.

### Done evidence
- shared dialog primitive and APG/native control tests
- accessibility tree and keyboard browser results
- extracted web module map
- before/after complexity and bundle report
- packaged SPA regression smoke

### Out of scope
- Broad visual redesign or new design system.
- Hosted accessibility/account flows.
- Moving orchestration decisions into React.

## W59-S04 — Code-quality, dependency, and dead-code ratchet

- **Outcome:** CI preserves the complete W57-S09 test baseline and prevents new
  lint/type/dependency/dead-code debt while allowing the recorded baseline to
  decrease incrementally.
- **Epic:** EPIC-0
- **State:** done
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** root lint/test/build scripts, ESLint/JS typecheck config,
  dependency audit, package gates, dead-code baseline
- **Hard dependencies:** W58-S08
- **Primary user story surfaces:** OPS-06, OPS-07, FIN-07; repository-quality
  enablement without direct product-story closure.
- **Audit findings:** Remaining quality-ratchet portions of AUD-047, AUD-051,
  AUD-053, and AUD-055; preservation proof for W57-S09/AUD-022.

### Local tasks
1. Starting from the patched W57-S09 baseline, enforce frozen install plus
   production/dev dependency, license-inventory, and advisory policy without
   treating every non-breaking update as an ad hoc backlog item; inventory
   cross-package relative imports and explicitly choose/enforce either real
   private workspace dependencies or the documented root-monolith package model.
2. Activate the existing JavaScript typecheck baseline, add scoped ESLint, and
   make one canonical stage pipeline report lint, type, test, build, audit, and
   package results without `slice:gate` executing the root stages twice.
3. Fail new duplicate keys, unused imports/locals, dependency cycles, or drift
   from the complete W57-S09 test manifest; keep CI/job and private-suite timeout
   budgets compatible with actionable diagnostics.
4. Re-scan the current HEAD, including provisional W60 modules, record diagnostic
   coverage plus per-hotspot baselines, and enforce named ceilings: new or extracted
   functions must stay below complexity 20, nesting depth 5, and 101 physical
   lines; new or extracted production files must stay below 1,001 physical lines;
   no new clone of 30 or more lines is permitted.
5. Remove confirmed dead internal symbols/imports/overwritten fields in bounded
   modules, beginning with the recorded loader/constants/helpers, stale SPA
   fields, and redundant React imports; add public export compatibility checks
   before removal.
6. Eliminate the duplicate example parse in reference integrity and add a bounded
   performance regression fixture.
7. Keep raw analyzer outputs under ignored `.aor` runtime evidence.

### Acceptance criteria
1. The patched Vite baseline remains unaffected by both recorded advisories and
   frozen dependency/license policy reports actionable drift by stage; workspace
   manifests and the documented package model no longer contradict the measured
   internal import graph.
2. All tracked tests remain discovered through W57-S09; manifest drift or a new
   undiscovered test fails CI.
3. Changed production modules cannot add lint/type/duplicate-key/dead-import
   debt, and each canonical quality stage executes once per gate.
4. Complexity and duplication baselines cannot regress silently, and CI reports
   the exact symbol/file/clone that exceeds the named ceiling.
5. Internal dead-code removal preserves documented exports/package contents.
6. Reference integrity parses each example once with identical diagnostics.

### Done evidence
- dependency/license/import-graph policy, audit, and package smoke
- ESLint/checkJs or equivalent scoped gate
- W57-S09 discovery-preservation and dead-export guards
- complexity/duplication baseline and ratchet
- reference-integrity performance fixture

### Out of scope
- Making every historical diagnostic clean in one change.
- Major module moves before characterization tests.
- Legal advice beyond inventory and policy evidence.

## W59-S05 — Core, CLI, and control-plane decomposition

- **Outcome:** Execution, review-report, and operator-control hotspots are split
  by stable behavior boundaries without changing contracts or reintroducing
  transport cycles.
- **Epic:** EPIC-0, EPIC-3, EPIC-6
- **State:** done
- **Remediation priority:** P2
- **Estimated effort:** XL
- **Primary modules:** step execution, review-report materialization, adapter
  invocation, CLI handlers, lifecycle/control-plane services, tests
- **Hard dependencies:** W58-S08, W59-S04
- **Primary user story surfaces:** ARC-06, DEV-01, DEV-05, OPS-01, OPS-06,
  OPS-10.
- **Audit findings:** Core/CLI/control-plane portions of AUD-049; preservation of
  the zero-cycle boundary closed by W58-S06/W58-S08 for AUD-048.

### Local tasks
1. Characterize routed execution, permission, repair, review-report
   materialization, persistence, and lifecycle behavior before module moves.
2. Split attempt allocation, route/policy decision, adapter invocation,
   permission mediation, repair control, and result persistence into focused
   services.
3. Split every affected CLI command handler from the command-runtime mega-barrel,
   import only actual dependencies, and partition the oversized CLI regression
   suite into focused command-family fixtures without reducing coverage.
4. Preserve the transport-neutral lifecycle boundary and keep CLI, HTTP, API, and
   app launcher as one-way adapters.
5. Remove the ESM cycle and introduce architecture/import guards.
6. Extract `materializeReviewReport` into validation, evidence aggregation,
   decision projection, and persistence boundaries with focused fixtures.
7. Apply the W59-S04 size/complexity ratchet after each bounded extraction.

### Acceptance criteria
1. No CLI/API/app transport imports another transport and madge reports no cycle.
2. Routed execution and run-control characterization suites remain behaviorally
   identical.
3. Handler modules import only used symbols, focused CLI suites preserve current
   behavior, and the command-runtime mega-barrel no longer owns unrelated domain
   behavior.
4. Attempt, permission, adapter, repair, and persistence services have explicit
   inputs/outputs and focused tests.
5. `executeRoutedStep`, `handleOperationsCommand`, and
   `materializeReviewReport` each finish at complexity 19 or lower, nesting depth
   4 or lower, and 100 physical lines or fewer; extracted production files stay
   at or below 1,000 physical lines without weakening coverage.

### Done evidence
- characterization suite and module dependency map
- extracted focused services and handler imports
- zero-cycle architecture guard
- before/after complexity metrics
- `pnpm check`

### Out of scope
- New product behavior or public contract fields.
- Replacing Node/process architecture with another platform.
- Web decomposition owned by W59-S03.

## W59-S06 — Adapter/live-E2E decomposition and contract-kernel parity

- **Outcome:** Provider supervision/parsing and private live-E2E stages are
  decomposed, while duplicated public/private contract logic has a mechanically
  enforced versioned parity model.
- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Remediation priority:** P2
- **Estimated effort:** XL
- **Primary modules:** `packages/adapter-sdk/**`, `scripts/live-e2e/**`,
  `packages/contracts/**`, private contract kernel, tests
- **Hard dependencies:** W58-S08, W59-S04
- **Primary user story surfaces:** DEV-01, DEV-07, AIP-02, AIP-03, AIP-04,
  OPS-06, OPS-07.
- **Audit findings:** Adapter/live-E2E portions of AUD-049 and AUD-050, plus the
  private-helper/parity portion of AUD-053. AUD-052 remains owned by W57-S06 and
  W58-S02; AUD-055 remains owned by W59-S04.

### Local tasks
1. Characterize adapter process supervision, provider parsing, permission
   semantics, packet compilation, and evidence writing.
2. Split adapter SDK into focused supervisor, parser, permission, packet, and
   evidence modules while keeping provider-specific behavior at the boundary.
3. Split full-journey live-E2E execution into bounded stage executors and isolate
   setup, browser, assessment, delivery, and closure responsibilities.
4. Replace unmanaged public/private contract copies, including loader, reference
   registry, and example-reference validation families, with generated pinned
   input or a pure versioned kernel that preserves the black-box runner boundary.
5. Add content-hash and behavior-fixture parity tests, including the provisional
   W60 structured-task families; require explicit version changes for intentional
   divergence.
6. Remove confirmed dead private helpers/fields only after profile, loader, and
   package-surface compatibility checks.
7. Publish before/after clone, complexity, and boundary metrics.

### Acceptance criteria
1. Adapter and live-E2E characterization tests preserve current supported
   behavior and provider-neutral public evidence.
2. Contract divergence is detected mechanically and requires an explicit
   compatibility version.
3. The private proof harness remains black-box and does not leak its vocabulary
   into `packages/**` or `apps/**` production source.
4. `executeFullJourneyFlow`, `writeProofRunnerArtifacts`, and the adapter
   `execute` method each finish at complexity 19 or lower, nesting depth 4 or
   lower, and 100 physical lines or fewer; extracted production files stay at or
   below 1,000 physical lines.
5. The public/private contract-kernel clone family has zero unmanaged 30-line
   clones, and duplicated lines across the audited adapter/live-E2E families fall
   by at least 30% from the W59-S04 baseline.
6. Package dry-run and installed smoke preserve public contents and behavior.

### Done evidence
- adapter/live-E2E characterization suites
- extracted module/stage map
- contract parity hash/behavior tests
- clone/complexity before-and-after reports
- package and boundary regression results

### Out of scope
- Credentialed full provider matrix as a root gate.
- Moving private rehearsal orchestration into public core.
- Rewriting all private profiles in one slice.

## W59-S07 — Independent audit closure and readiness decision

- **Outcome:** Every AUD-001 through AUD-055 item receives independent closure
  evidence or an explicit accepted/open disposition, and repository readiness
  claims are recalibrated without automatically publishing a release.
- **Epic:** EPIC-0, EPIC-5, EPIC-7
- **State:** done
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** audit report/ledger, backlog/story evidence, readiness and
  release docs, root/package/browser/concurrency gates
- **Hard dependencies:** W59-S02, W59-S03, W59-S04, W59-S05, W59-S06
- **Primary user story surfaces:** OPS-06, OPS-07, PSO-06, FIN-03.
- **Audit findings:** AUD-001 through AUD-055 final disposition.

### Local tasks
1. Re-run every original safe repro/invariant probe against the remediated code,
   inventory the code/backlog delta from audit baseline `db995171` through closure
   (including provisional W60), and preserve exact versions, commands, and
   limitations.
2. Require an independent second review of every original S1 finding and any
   public compatibility removal.
3. Repeat concurrency, clean-first-load, loopback HTTP, browser, package,
   dependency, no-write, and no-upstream-write matrices.
4. Record each finding as resolved, accepted risk, superseded, or still open with
   evidence, compatibility impact, and follow-up owner.
5. Reconcile README, roadmap, story coverage, production-readiness, release
   runbooks, and package claims to the verified result; require every roadmap
   summary wave to have a detailed section/file, every slice count/allocation to
   match its owner, current version claims to match package metadata, and landed
   provisional implementation to remain distinct from accepted/done state.
6. Preserve explicit gaps for Windows, credentialed providers, paid calls, real
   upstream writes, and hosted web.
7. Make a release/readiness decision separately from audit closure; do not publish
   or push as part of the slice.

### Acceptance criteria
1. The closure ledger contains all 55 IDs, no duplicate root causes, direct
   evidence for every resolved bug/dead-code claim, and an explicit disposition
   for each post-baseline delta finding.
2. Every original S1 has an independent passing regression or remains an explicit
   release blocker.
3. Root, package, browser, concurrency, audit, license, and dependency gates pass
   on the supported Node 22 environment.
4. Story/readiness claims do not exceed the verified surfaces or hide excluded
   hosted/credentialed/Windows gaps; roadmap wave/detail/count/allocation and
   provisional-versus-accepted implementation claims are structurally consistent.
5. The tracked tree contains only approved source/docs/tests; raw runtime evidence
   remains ignored under `.aor`.

### Done evidence
- English remediation closure report and machine-readable ledger
- independent S1 verification matrix
- root/package/browser/concurrency gate results
- updated story/readiness/release source of truth
- `pnpm slice:gate`

### Out of scope
- Automatic npm/GitHub release publication.
- Hosted frontend or enterprise identity launch.
- Destructive proofs, real upstream writes, or paid-provider requirements.
