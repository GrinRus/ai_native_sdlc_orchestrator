# W59 implementation slices

W59 turns the remaining operator-surface and maintainability findings into
behavioral gates and bounded refactors after W57/W58 restore trustworthy runtime
semantics. The wave closes the July 2026 audit; it does not automatically publish
a release or broaden the product into hosted web.

The frontend remains local-only. W59 improves correctness, live state,
accessibility, tests, and maintainability. It does not add login, remote bearer
token handling, multi-user authorization, public deployment, or frontend-owned
orchestration.

Priorities use the audit remediation scale (`P0` release blocker, `P1` next
repair lane, `P2` planned). Effort estimates use `XS/S/M/L/XL` and include
implementation, characterization/regression tests, metrics, and documentation.

## W59-S01 — Executable browser and component behavior gate

- **Outcome:** Web acceptance executes the packaged SPA and asserts user-visible
  behavior instead of treating JSX/bundle marker strings as functional proof.
- **Epic:** EPIC-0, EPIC-6, EPIC-7
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/test/**`, browser/component harness,
  app package smoke, CI/release tests
- **Hard dependencies:** W58-S08
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-06, OPS-07,
  OPS-11.
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
   timeouts and actionable artifacts outside Git.

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

### Done evidence
- component/browser harness and deterministic fixtures
- clean-first-load and live-state behavior tests
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
  the operator handle every pending interaction/decision.
- **Epic:** EPIC-1, EPIC-6
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/src/**`, local control-plane client, web fixtures,
  shared read models
- **Hard dependencies:** W59-S01
- **Primary user story surfaces:** ARC-06, PBO-09, EMP-05, OPS-01, OPS-02,
  OPS-04, OPS-10, OPS-11.
- **Audit findings:** AUD-039, AUD-040, AUD-041, AUD-042, AUD-054.

### Local tasks
1. Create one same-origin control-plane client using the supported local config,
   EventSource cursor/reconnect, and bounded polling fallback.
2. Close/abort old streams and requests on project/flow switch and commit one
   generation-keyed project snapshot instead of independent stale setters.
3. Track loading, connected, partial, stale, offline, and per-resource error state
   separately from authoritative empty data.
4. Preserve last-known state on partial failure and disable decisions that depend
   on missing resources.
5. Add accessible selection and independent draft state for every queued
   interaction and decision rather than fixed `[0]` access.
6. Render package/app-config version and remove stale hard-coded display values.
7. Remove, reserve, or explicitly document unsupported arbitrary-remote UI config
   fields without breaking the headless detached API.

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

### Done evidence
- typed/local control-plane client tests
- project generation/abort race fixtures
- partial/offline/error-state browser tests
- multi-item interaction/decision tests
- version/config compatibility tests

### Out of scope
- Remote SPA to arbitrary control-plane connectivity.
- Browser bearer token lifecycle, login, OAuth/SSO, RBAC, or tenant switching.
- Frontend-owned runtime decisions.

## W59-S03 — Accessible local dialogs and web state decomposition

- **Outcome:** Local console dialogs follow accessible keyboard semantics, and
  state/client/feature boundaries are decomposed behind the W59-S01 behavior gate.
- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
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
   dialog state, and feature views from the monolithic SPA.
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
5. `FlowCockpit` and `App` no longer exceed complexity 19, nesting depth 4, or
   100 physical lines after extraction; every extracted production file stays at
   or below 1,000 physical lines, with no unbounded compatibility facade.

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

- **Outcome:** CI discovers all tests and prevents new lint/type/dependency/dead
  code debt while allowing the recorded baseline to decrease incrementally.
- **Epic:** EPIC-0
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** root lint/test/build scripts, ESLint/JS typecheck config,
  dependency audit, package gates, dead-code baseline
- **Hard dependencies:** W58-S08
- **Primary user story surfaces:** OPS-06, OPS-07, FIN-07; repository-quality
  enablement without direct product-story closure.
- **Audit findings:** AUD-022, AUD-047, AUD-051, AUD-053, AUD-055.

### Local tasks
1. Upgrade Vite to a patched supported version and record a production/dev
   dependency audit policy with frozen-install enforcement.
2. Add scoped ESLint and JavaScript type checking with an explicit current
   baseline and changed-module ratchet.
3. Fail new duplicate keys, unused imports/locals, dependency cycles, and
   undiscovered test files.
4. Record per-hotspot baselines and enforce named ceilings: new or extracted
   functions must stay below complexity 20, nesting depth 5, and 101 physical
   lines; new or extracted production files must stay below 1,001 physical lines;
   no new clone of 30 or more lines is permitted.
5. Remove confirmed dead internal symbols/imports/overwritten fields in bounded
   modules and add public export compatibility checks before removal.
6. Eliminate the duplicate example parse in reference integrity and add a bounded
   performance regression fixture.
7. Keep raw analyzer outputs under ignored `.aor` runtime evidence.

### Acceptance criteria
1. Frozen install resolves Vite at a version unaffected by both recorded
   advisories and audit reports no corresponding finding.
2. All tracked tests are discovered; new undiscovered tests fail CI.
3. Changed production modules cannot add lint/type/duplicate-key/dead-import debt.
4. Complexity and duplication baselines cannot regress silently, and CI reports
   the exact symbol/file/clone that exceeds the named ceiling.
5. Internal dead-code removal preserves documented exports/package contents.
6. Reference integrity parses each example once with identical diagnostics.

### Done evidence
- dependency upgrade/audit and package smoke
- ESLint/checkJs or equivalent scoped gate
- test-discovery and dead-export guards
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
- **State:** blocked
- **Remediation priority:** P2
- **Estimated effort:** XL
- **Primary modules:** step execution, review-report materialization, adapter
  invocation, CLI handlers, lifecycle/control-plane services, tests
- **Hard dependencies:** W58-S08, W59-S04
- **Primary user story surfaces:** ARC-06, DEV-01, DEV-05, OPS-01, OPS-06,
  OPS-10.
- **Audit findings:** AUD-048 and core/CLI/control-plane portions of AUD-049.

### Local tasks
1. Characterize routed execution, permission, repair, review-report
   materialization, persistence, and lifecycle behavior before module moves.
2. Split attempt allocation, route/policy decision, adapter invocation,
   permission mediation, repair control, and result persistence into focused
   services.
3. Split CLI command handlers from the command-runtime mega-barrel and import only
   actual dependencies.
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
3. Handler modules import only used symbols and the command-runtime mega-barrel no
   longer owns unrelated domain behavior.
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
- **State:** blocked
- **Remediation priority:** P2
- **Estimated effort:** XL
- **Primary modules:** `packages/adapter-sdk/**`, `scripts/live-e2e/**`,
  `packages/contracts/**`, private contract kernel, tests
- **Hard dependencies:** W58-S08, W59-S04
- **Primary user story surfaces:** DEV-01, DEV-07, AIP-02, AIP-03, AIP-04,
  OPS-06, OPS-07.
- **Audit findings:** adapter/live-E2E portions of AUD-049, AUD-050, AUD-052,
  AUD-053, AUD-055.

### Local tasks
1. Characterize adapter process supervision, provider parsing, permission
   semantics, packet compilation, and evidence writing.
2. Split adapter SDK into focused supervisor, parser, permission, packet, and
   evidence modules while keeping provider-specific behavior at the boundary.
3. Split full-journey live-E2E execution into bounded stage executors and isolate
   setup, browser, assessment, delivery, and closure responsibilities.
4. Replace unmanaged public/private contract copies with generated pinned input or
   a pure versioned kernel that preserves the black-box runner boundary.
5. Add content-hash and behavior-fixture parity tests; require explicit version
   changes for intentional divergence.
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
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** audit report/ledger, backlog/story evidence, readiness and
  release docs, root/package/browser/concurrency gates
- **Hard dependencies:** W59-S02, W59-S03, W59-S04, W59-S05, W59-S06
- **Primary user story surfaces:** OPS-06, OPS-07, PSO-06, FIN-03.
- **Audit findings:** AUD-001 through AUD-055 final disposition.

### Local tasks
1. Re-run every original safe repro/invariant probe against the remediated code and
   preserve exact versions, commands, and limitations.
2. Require an independent second review of every original S1 finding and any
   public compatibility removal.
3. Repeat concurrency, clean-first-load, loopback HTTP, browser, package,
   dependency, no-write, and no-upstream-write matrices.
4. Record each finding as resolved, accepted risk, superseded, or still open with
   evidence, compatibility impact, and follow-up owner.
5. Reconcile README, roadmap, story coverage, production-readiness, release
   runbooks, and package claims to the verified result.
6. Preserve explicit gaps for Windows, credentialed providers, paid calls, real
   upstream writes, and hosted web.
7. Make a release/readiness decision separately from audit closure; do not publish
   or push as part of the slice.

### Acceptance criteria
1. The closure ledger contains all 55 IDs, no duplicate root causes, and direct
   evidence for every resolved bug/dead-code claim.
2. Every original S1 has an independent passing regression or remains an explicit
   release blocker.
3. Root, package, browser, concurrency, audit, license, and dependency gates pass
   on the supported Node 22 environment.
4. Story/readiness claims do not exceed the verified surfaces or hide excluded
   hosted/credentialed/Windows gaps.
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
