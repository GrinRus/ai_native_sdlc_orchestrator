# W36 - no-settings onboarding and local multi-project UI

Make the installed local app self-guided from `aor app` and support several
explicitly added local projects in one loopback console while preserving
headless-first runtime ownership.

## Wave objective

An installed user can run `cd <repo> && aor app`, follow a UI wizard through
project context, explicit runtime initialization, first mission intake, and
next-action handoff, then switch between explicitly added local projects without
mixing runtime roots, flow selections, evidence refs, or operator requests.

## Wave exit criteria

- `aor app`, `aor app --project-ref <repo>`, and `--runtime-root <path>` remain
  backward compatible for single-project use.
- `/app-config.json` remains compatible and adds `default_project_id` plus
  `projects[]` for local app-session project summaries.
- `GET /api/projects` returns local workspace project summaries without scanning
  the filesystem or auto-creating `.aor/` runtime state.
- Existing `/api/projects/:projectId/**` routes dispatch to the matching project
  runtime context and reject unknown project ids.
- The SPA renders a first-run wizard and project switcher from public read
  surfaces; initialization remains an explicit user action.
- Smoke/proof covers a clean temp repo and two local projects in one app session.

---

## W36-S01 — No-settings onboarding and workspace contract baseline
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Source-of-truth docs define the no-settings first-run wizard, local app project registry, explicit initialization boundary, and local multi-project non-goals before runtime/UI implementation.
- **Primary modules:** `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/backlog/**`
- **Hard dependencies:** W35-S04
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10.

### Local tasks
1. Add W36 to roadmap, master backlog, epic map, dependency graph, and story traceability.
2. Define the first-run wizard stages: Project Context, Runtime Readiness, First Flow, and Next Action.
3. Define local app workspace semantics for explicitly added projects.
4. Preserve the distinction between bounded multirepo inside one project profile and multiple independent local `project_id` contexts in one UI.
5. Document that hosted SaaS, tenant collaboration, portfolio optimization, and upstream writes are out of scope.

### Acceptance criteria
1. Backlog source-of-truth docs agree on W36 slice ownership and dependencies.
2. Product/architecture/contract docs describe the additive public surfaces.
3. Story traceability maps W36 to installed-user onboarding and operator visibility.
4. No source-of-truth text claims hosted multi-tenant or portfolio orchestration support.

### Done evidence
- `docs/backlog/wave-36-implementation-slices.md`
- roadmap, master backlog, dependency graph, and epic-map updates
- product, architecture, and contract notes for local app workspace

### Out of scope
- Hosted SaaS or managed multi-tenant control plane.
- Organization-wide portfolio optimization.
- Automatic filesystem project discovery.

---

## W36-S02 — App workspace and project registry
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The local app server can expose and route several explicitly registered local projects while keeping the existing single-project launch path compatible.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/api/**`, `docs/contracts/**`, tests
- **Hard dependencies:** W36-S01
- **Primary user story surfaces:** PBO-09, OPS-01, RMO-01.

### Local tasks
1. Add a non-writing project preview/readiness helper for app config and project summaries.
2. Add an in-memory local app project registry seeded by the current `project-ref`.
3. Extend `/app-config.json` with `default_project_id` and `projects[]`.
4. Add `GET /api/projects` and a bounded local add-project mutation.
5. Dispatch existing `/api/projects/:projectId/**` routes to the selected runtime context.
6. Preserve project-scoped auth checks and unknown-project fail-closed behavior.

### Acceptance criteria
1. Single-project app launch returns the original app config fields plus additive project-list fields.
2. `GET /api/projects` returns summaries for the registered projects.
3. Unknown `projectId` requests return `project_not_found`.
4. Two registered projects keep separate runtime roots and flow/evidence reads.
5. Project-list reads do not initialize `.aor/`; initialization remains explicit.

### Done evidence
- app launcher/runtime registry implementation
- API/control-plane tests for single-project compatibility and project isolation
- OpenAPI/control-plane contract updates

### Out of scope
- Persisted global project workspace across app restarts.
- Automatic repo scanning.

---

## W36-S03 — First-run onboarding wizard
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The packaged SPA guides a clean installed user from `aor app` to initialized runtime, first mission intake, next-action refresh, and flow cockpit without requiring README setup.
- **Primary modules:** `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W36-S02
- **Primary user story surfaces:** PBO-01, PBO-02, PBO-03, PBO-09.

### Local tasks
1. Replace the single Readiness action with a four-step wizard.
2. Resume existing projects by skipping initialized/flow-ready steps.
3. Submit project initialization through lifecycle-command `project init`.
4. Submit first-flow mission intake with `delivery-mode=no-write` by default.
5. Refresh `next` and land in the active flow cockpit.
6. Show path/runtime/profile errors as readable UI states.

### Acceptance criteria
1. Clean-project UI shows Project Context before any flow exists.
2. Initialize is explicit and visibly advances readiness.
3. First Flow uses the safe mission template and required-field validation.
4. Next Action refresh succeeds before the wizard lands in the flow cockpit.
5. Existing initialized projects with flows open directly to the flow selector/cockpit.

### Done evidence
- web wizard implementation
- web tests for clean, initialized, and existing-flow states
- app smoke markers for wizard and initialize action

### Out of scope
- UI-owned orchestration decisions.
- Changing mission/intake packet schemas.

---

## W36-S04 — Local multi-project switcher UX
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Operators can add and switch between local projects in one app session while state, flows, evidence, and actions stay scoped to the selected project.
- **Primary modules:** `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W36-S03
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10.

### Local tasks
1. Add a top-bar project switcher with project label, status, and runtime root hint.
2. Add an Add local project drawer with path, optional label, runtime-root preview, validation, and initialize action.
3. Reset selected flow, evidence detail, operator request draft, activity, and wizard state when active project changes.
4. Render empty states separately for uninitialized, initialized without flows, active flow, and completed flows.
5. Keep raw project refs available as debug/copy detail without making them the primary visual label.

### Acceptance criteria
1. Switching projects reloads all read models for the selected `project_id`.
2. Evidence refs, selected flow, operator requests, and activity do not leak across projects.
3. Add-project validates explicit paths and reports errors without raw stack traces.
4. The UI explains uninitialized projects without auto-running initialization.

### Done evidence
- project switcher and add-project drawer
- web tests for switch/reset/isolation behavior
- API tests for add-project mutation and duplicate/collision handling

### Out of scope
- Persisting a global recent-project list outside the app process.
- Cross-project flow orchestration.

---

## W36-S05 — Docs, smoke, and proof
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** README, runbooks, smoke checks, and browser proof show that no-settings onboarding and local multi-project switching work through public installed-user surfaces.
- **Primary modules:** `README.md`, `docs/ops/**`, `apps/web/**`, `packages/orchestrator-core/**`, `scripts/**`, tests
- **Hard dependencies:** W36-S04
- **Primary user story surfaces:** OPS-06, OPS-10, PBO-09.

### Local tasks
1. Update README quickstart so the primary UI path is `cd <repo> && aor app`.
2. Keep `doctor/onboard` documented as advanced/headless commands.
3. Update local UI runbooks for clean first-run wizard and multi-project workspace.
4. Expand app smoke for wizard, initialize action, project switcher, flow selector, and `New Flow`.
5. Add browser/live-style proof fixtures for clean temp repo and two local projects.

### Acceptance criteria
1. README says how to launch the clean UI without setup flags.
2. App smoke proves wizard and project switcher markers in the packaged bundle.
3. Two-project smoke proves distinct project ids/runtime roots in one app session.
4. Headless CLI/API behavior remains valid without the web UI.
5. W35-S05 remains separate and blocked until clean live proof or replanning.

### Done evidence
- README and runbook updates
- smoke/test output for clean and two-project app launch
- slice gate evidence

### Out of scope
- Publishing a new release.
- Completing blocked W35-S05 proof.
