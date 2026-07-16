# W61 - project topology, bindings, execution setup, and management UX

W61 makes single-repo, monorepo, and bounded multirepo projects configurable
through portable project definitions plus machine-local bindings. It extends
the local project switcher into an explicit neutral Local Workspace, Project
Structure management, and approved execution-route setup while preserving
independent runtime/flow state for separate AOR projects.

## Wave objective

Repository owners and installed users can create, validate, rebind, inspect,
configure execution readiness, and safely evolve project topology without
editing raw YAML or leaking local paths or credentials into portable project
profiles.

## Wave exit criteria

- Product and architecture distinguish Local Workspace, AOR Project,
  Repository, Component, Project Binding, and Workspace Set.
- `project-profile` represents repositories and optional components without
  treating monorepo packages as separate Git repositories.
- A persistent operator-local registry survives app restart and stores
  machine-local bindings outside target project profiles.
- Bare `aor app` can open a neutral Local Workspace outside Git with no selected
  project, filesystem scan, implicit initialization, or launcher-directory
  write.
- CLI/API/UI support explicit repository/component add, edit, rebind, disable,
  reanalyze, and validate flows with project-scoped authorization.
- The UI and proof distinguish adding another independent AOR Project from
  adding a Repository to the selected Project.
- Approved route selection and runner/provider/model readiness are inspectable
  and configurable through contract-owned CLI/API/UI surfaces without exposing
  credentials or accepting arbitrary model strings.
- The Add Project flow and Project Structure cover loading, empty, partial,
  invalid, dirty, unavailable, ref-drift, permission, and recovery states.
- Single-project `cd <repo> && aor app` and existing project profiles remain
  backward-compatible.

---

## W61-S01 — Project topology and local binding contract baseline

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-2 Packet lifecycle;
  EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Define portable topology, machine-local binding, component, and
  workspace-set boundaries before persistence or UI behavior depends on them.
- **Primary modules:** `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `examples/project*.aor.yaml`, `packages/contracts/**`, tests
- **Hard dependencies:** W60-S01
- **Primary user story surfaces:** RMO-01, RMO-02, PBO-01, PBO-07, PBO-08, ARC-01.

### Local tasks

1. **Record the architecture decision and vocabulary.**
   - Purpose: stop using project root, Git root, local binding, and execution
     root as interchangeable concepts.
   - Changes: define ownership, persistence, security, and lifecycle for Local
     Workspace, AOR Project, Repository, Component, Binding, and Workspace Set.
   - Validation: architecture, project description, operating model, and UX
     source of truth use identical terms.
2. **Extend the portable project-profile model.**
   - Purpose: represent monorepo components and bounded multirepo topology
     without machine-specific paths.
   - Changes: add optional `components[]`, component dependencies, repository
     workspace mount metadata, roles, commands, and compatibility aliases for
     current `source.root` behavior.
   - Validation: existing single-repo, monorepo, and bounded multirepo examples
     validate without mandatory migration.
3. **Define the machine-local project-binding contract.**
   - Purpose: persist local paths and checkout availability outside portable
     profiles and committed evidence.
   - Changes: define project/profile refs, repository local paths or clone
     sources, resolved identity, credential readiness summary, status, and
     redaction rules.
   - Validation: absolute paths never appear in portable profile examples and
     secret-bearing values are forbidden.
4. **Define workspace-set and shared-repository safety invariants.**
   - Purpose: prepare later run isolation and handle one physical repository
     referenced by multiple AOR projects.
   - Changes: specify stable mount paths, base refs, resolved commits,
     non-overlapping project scopes, and blocking conflict evidence.
   - Validation: invalid duplicate mounts, overlapping write scopes, unknown
     repos/components, and ambiguous source roots fail deterministically.
5. **Add migration, examples, and validation coverage.**
   - Purpose: make topology upgrades inspectable and reversible.
   - Changes: add single-repo, monorepo-components, bounded-multirepo, shared-repo
     read-only, and invalid-binding fixtures plus compatibility notes.
   - Validation: contract/reference tests prove old and new profiles load through
     one path.

### Acceptance criteria

1. Portable profiles and machine-local bindings have separate contracts and stores.
2. Monorepo apps/packages/services are represented as components of one repo.
3. Existing profiles remain valid and have deterministic in-memory defaults.
4. Shared physical repository write scopes fail closed when overlap is unsafe.
5. Workspace-set identity is defined without implementing run provisioning yet.

### Done evidence

- architecture decision and updated product/contract docs
- project-profile, local-binding, and workspace-set examples
- compatibility and invalid-topology tests
- `pnpm slice:plan -- W61-S02`

### Out of scope

- Persistent registry implementation.
- Repository cloning or worktree provisioning.
- Topology management UI.

---

## W61-S02 — Persistent local workspace registry and topology discovery

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Open a neutral Local Workspace, persist explicitly connected
  projects and repository bindings, then analyze repositories/components
  without automatic filesystem discovery.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/cli/**`,
  `apps/api/**`, local registry and project-analysis tests
- **Hard dependencies:** W61-S01
- **Primary user story surfaces:** PBO-01, PBO-03, PBO-07, PBO-08, PBO-10,
  RMO-01, RMO-02.

### Local tasks

1. **Choose and implement the operator-local registry store.**
   - Purpose: preserve explicitly added projects across `aor app` restarts
     without writing machine-local metadata into target repositories.
   - Changes: add one default local workspace registry under AOR-owned user
     state, atomic writes, versioning, locking, corruption recovery, an
     explicit ephemeral mode for tests, and a neutral state with
     `selected_project_id = null`.
   - Validation: restart, duplicate, collision, concurrent read/write, invalid
     file, and migration tests pass.
2. **Persist and resolve repository bindings safely.**
   - Purpose: map portable repo IDs to local checkouts or clone sources.
   - Changes: normalize paths, resolve Git identity, redact sensitive values,
     classify available/unavailable/not-git/permission states, and avoid
     initializing target runtimes during reads.
   - Validation: bindings outside the project directory work while secrets and
     unrelated filesystem entries remain unread/unlisted.
3. **Add deterministic component and command discovery.**
   - Purpose: propose useful topology without pretending heuristic findings are
     approved configuration.
   - Changes: detect workspace/package manifests, app/service roots, toolchain
     commands, default refs, and likely component roles with confidence/source
     evidence.
   - Validation: fixtures cover single repo, JS monorepo, mixed-language
     monorepo, bounded multirepo, and no-manifest repositories.
4. **Add dependency and validation proposal evidence.**
   - Purpose: let operators review discovered cross-component/repo relations.
   - Changes: propose edges from explicit manifests/config, preserve source refs,
     and mark inferred edges as proposals until accepted.
   - Validation: unknown/ambiguous edges do not silently enter the approved
     profile or execution scope.
5. **Preserve isolation and backward compatibility.**
   - Purpose: retain W36 project switching and clean single-repo launch behavior.
   - Changes: seed the persistent registry from existing launch flags, keep
     runtime roots/project IDs isolated, retain repo-attached
     `cd <repo> && aor app`, and let bare `aor app` outside Git open the neutral
     workspace without selecting the last project automatically.
   - Validation: current app-config, project index, duplicate/collision,
     neutral-launch, restart, and two-project isolation tests remain valid;
     the launcher directory receives no `.aor/` or other runtime artifact.

### Acceptance criteria

1. Explicitly added projects and bindings survive app restart.
2. Bare `aor app` outside Git opens a neutral workspace with no selected
   project, and registry reads do not scan the filesystem, initialize `.aor/`,
   or write into the launcher directory.
3. Discovery proposals include source/confidence evidence and require approval.
4. Unavailable or invalid repositories keep the project inspectable and expose
   recovery actions.
5. Existing one-project launch and W36 isolation remain compatible, and the
   neutral workspace does not restore a sticky UI selection as CLI context.

### Done evidence

- persistent registry and binding implementation tests
- topology discovery fixtures and proposal evidence
- restart/corruption/isolation test output
- migration note for the in-memory registry

### Out of scope

- Repository management UI.
- Execution workspace creation.
- Hosted or shared registry synchronization.

---

## W61-S03 — Project topology CLI/API management and validation

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Expose project, repository, component, dependency, binding, and
  validation management through auditable headless surfaces.
- **Primary modules:** `apps/cli/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/contracts/control-plane-api.md`,
  OpenAPI/examples, tests
- **Hard dependencies:** W61-S02
- **Primary user story surfaces:** RMO-01, RMO-02, PBO-03, PBO-04, PBO-05,
  OPS-01, OPS-10.

### Local tasks

1. **Define headless command and API ownership.**
   - Purpose: ensure every future UI mutation has a stable CLI/API/control-plane
     path.
   - Changes: make `GET /api/projects` and `POST /api/projects/actions`
     workspace-scoped and usable without an active project; add project
     create/import, repo/component list/add/update/disable, binding rebind,
     dependency update, reanalyze, and validate command/API semantics with
     compatibility wrappers for current add-project behavior.
   - Validation: command catalog, OpenAPI, control-plane examples, and handlers
     agree on payloads and authorization.
2. **Implement bounded mutations and revision evidence.**
   - Purpose: avoid raw profile editing and preserve topology history.
   - Changes: validate IDs/paths/refs, write profile or binding revisions to the
     owning store, record before/after summaries, and invalidate affected
     readiness/plan evidence on material changes.
   - Validation: invalid scope, duplicate IDs, active-run conflicts, stale
     revision, and unknown project/repo/component fail closed.
3. **Implement topology validation reports.**
   - Purpose: give operator-facing status for profile, binding, repository,
     component, dependency, command, and shared-scope checks.
   - Changes: produce deterministic findings, blocking level, evidence refs, and
     recommended recovery actions without raw stack traces.
   - Validation: pass, warn, partial, unavailable, dirty, ref-drift, and overlap
     fixtures produce stable codes.
4. **Enforce project/auth/redaction boundaries.**
   - Purpose: keep machine-local paths and repository state from leaking across
     project contexts or unauthorized reads.
   - Changes: apply existing local-trusted/production auth modes, sanitize
     summaries, reject wrong-project mutations, and keep secrets out of logs.
   - Validation: CLI/API/SSE/error payload tests cover denial and redaction.
5. **Preserve current onboarding and app API compatibility.**
   - Purpose: avoid breaking installed users while richer routes land.
   - Changes: retain `/api/projects/actions` add semantics, app config fields,
     existing lifecycle commands, and default single-repo behavior while
     keeping project-scoped routes unavailable until a project is selected.
   - Validation: existing HTTP/app smoke tests pass alongside neutral-workspace
     list/add tests and new project-scoped management tests.

### Acceptance criteria

1. All topology and binding mutations are available headlessly before UI use.
2. Material topology changes write revision evidence and invalidate stale plans.
3. Validation reports provide stable blocker codes and recovery actions.
4. Project/auth/redaction boundaries fail closed without state leakage.
5. Existing app launch/add-project APIs remain compatible.
6. Workspace-scoped project list/add routes work with no active project while
   project-scoped mutations still require an explicit selected project.

### Done evidence

- CLI command and API/OpenAPI updates
- mutation, revision, validation, auth, and compatibility tests
- control-plane request/response examples
- readable topology validation fixtures

### Out of scope

- Web implementation.
- Repository clone/worktree execution.
- Portfolio-level cross-project transactions.

---

## W61-S04 — Add Project and Project Structure UX

- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Let installed users configure and recover project topology through
  an accessible setup flow and project-scoped management surface.
- **Primary modules:** `apps/web/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/product/**`, browser tests
- **Hard dependencies:** W61-S03
- **Primary user story surfaces:** PBO-01, PBO-03, PBO-08, PBO-09, PBO-10,
  RMO-01, RMO-02, OPS-01, OPS-10.

### Local tasks

1. **Extract project-structure feature modules.**
   - Purpose: avoid extending the current large SPA/CSS files with another
     tightly coupled feature.
   - Changes: create focused setup, repository, component, dependency, and
     validation modules while preserving current project switcher behavior.
   - Validation: existing onboarding/project switching tests pass before the new
     flow is enabled.
2. **Implement the Add Project setup flow.**
   - Purpose: support single-repo, monorepo, and bounded multirepo setup without
     raw YAML editing.
   - Changes: label this workspace-level operation `Add AOR Project`; add
     Identity, Topology, Repositories, Components, Dependencies, and Review
     steps with back navigation, dirty-draft confirmation, validation, and
     explicit initialize.
   - Validation: opening or validating never initializes runtime state; keyboard
     and focus order remain deterministic.
3. **Implement Project Structure management.**
   - Purpose: make topology health and common actions scannable for repeated use.
   - Changes: add Overview, Repositories, Components, Dependencies, and
     Validation views with an explicit
     `Project Structure -> Repositories -> Add repository` mutation plus
     edit/rebind/disable/reanalyze actions and raw refs behind secondary details.
   - Validation: dense tables, long labels, narrow viewports, and empty/partial
     states remain usable without overlap.
4. **Implement failure and recovery states.**
   - Purpose: keep invalid or partially available projects recoverable.
   - Changes: render unavailable, not-git, dirty, ref-drift, invalid component,
     overlap, permission, disconnected, stale, and active-run-conflict states
     with one safe recovery action.
   - Validation: each state has browser tests, accessible status text, and no raw
     stack traces.
5. **Preserve project/flow isolation and safety.**
   - Purpose: prevent state leakage and unsafe mutation while switching projects.
   - Changes: reset topology drafts/details with other project-scoped state,
     disable conflicting actions during active runs, and show write-effect
     previews before initialize or destructive changes.
   - Validation: separate fixtures prove two independent Projects in one Local
     Workspace and one selected Project with two Repositories; forms, flow,
     evidence, topology, and runtime state do not leak across Projects.

### Acceptance criteria

1. Users can configure all supported topologies without editing YAML.
2. The Project switcher adds or selects independent AOR Projects, while
   Project Structure adds Repositories only inside the selected Project.
3. Setup distinguishes portable profile data from machine-local bindings.
4. Initialization and destructive changes are explicit and preview write effects.
5. Project Structure provides readable management and recovery for required states.
6. The UI is keyboard-complete, responsive, accessible, and project-isolated.

### Done evidence

- extracted project-structure UI modules
- setup/management/recovery browser tests
- accessibility, responsive, and two-project isolation evidence
- screenshots/DOM evidence for each topology and key blocker state

### Out of scope

- Graph-first topology editing.
- Execution DAG or child-run views.
- Hosted project collaboration.

---

## W61-S05 — Topology onboarding proof and documentation closure

- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Prove project topology and approved execution-route setup through
  installed-user and headless paths while preserving current no-settings
  compatibility.
- **Primary modules:** `README.md`, `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`,
  `scripts/live-e2e/**`, root checks
- **Hard dependencies:** W61-S07
- **Primary user story surfaces:** PBO-08, PBO-09, PBO-10, RMO-01, RMO-02,
  OPS-06, OPS-10.

### Local tasks

1. **Build topology fixtures and installed-user scenarios.**
   - Purpose: cover single-repo compatibility, monorepo components, and bounded
     multirepo bindings through public surfaces.
   - Changes: add disposable targets/profiles and explicit local binding setup
     without relying on filesystem scan or private repositories.
   - Validation: fixtures separately prove two independent Projects and one
     bounded multirepo Project, and remain no-write unless a later delivery
     proof says otherwise.
2. **Exercise persistence and recovery.**
   - Purpose: prove registry restart, unavailable repository, rebind, ref drift,
     validation, and disabled-component behavior.
   - Changes: capture before/after registry/profile/binding/report evidence.
   - Validation: recovery does not lose unrelated project/flow state.
3. **Run browser-task UX assessment.**
   - Purpose: validate setup comprehension and repeated management work.
   - Changes: capture keyboard, focus, responsive, accessibility, task outcome,
     screenshots, execution-setup readiness/recovery, and UX findings for all
     three topologies.
   - Validation: graph-independent dependency editing and blocker recovery pass.
4. **Refresh documentation and compatibility claims.**
   - Purpose: make installed-user and headless guidance match implementation.
   - Changes: update README, onboarding journey, project description, contracts,
     command/API docs, runbooks, and examples.
   - Validation: docs distinguish one bounded multirepo project from several
     independent project IDs in the local workspace and distinguish route
     selection from machine-local readiness and credential storage.
5. **Classify findings and run gates.**
   - Purpose: close the wave with reviewable proof rather than screenshots alone.
   - Changes: classify findings, create follow-up slices, run root/slice gates,
     and verify local bindings/runtime state are not committed.
   - Validation: W61 closure has public proof refs and clean repository status.

### Acceptance criteria

1. Public proof covers single-repo, monorepo, and bounded multirepo onboarding.
2. Persistent registry and rebind/recovery behavior survive restart.
3. Browser proof covers accessibility, responsive layout, project isolation,
   and approved execution-route setup and recovery.
4. Documentation accurately separates profile, binding, workspace, and project ID.
5. No local binding, credential, or runtime state is committed.

### Done evidence

- topology fixtures and installed-user proof refs
- persistence/recovery and browser-task evidence
- approved route selection and execution-readiness proof
- updated docs/contracts/runbooks/examples
- passing root and slice gates

### Out of scope

- Parallel execution.
- Coordinated write-back proof.
- Publishing a release.

---

## W61-S06 — Project execution profile and runner-readiness contract

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-3 Execution;
  EPIC-6 Operator surface
- **State:** done
- **Outcome:** Operators can inspect, select, reset, and check an approved
  project execution route through one contract-owned CLI/API surface, with
  truthful runner/provider/model readiness and no credential disclosure.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `docs/contracts/**`, canonical route/readiness examples,
  `packages/orchestrator-core/**`, `packages/provider-routing/**`, `apps/cli/**`,
  `apps/api/**`, OpenAPI and contract tests
- **Hard dependencies:** W61-S03
- **Primary user story surfaces:** PBO-10, AIP-03, AIP-04, OPS-03, OPS-11,
  SEC-02.

### Local tasks

1. **Define execution-profile ownership and compatibility.**
   - Purpose: avoid adding a second configuration source or exposing a model
     selector that does not control actual execution.
   - Changes: consume the accepted executable route semantics from W58-S03 and
     canonical API/error boundary from W58-S06; keep portable
     `project-profile.default_route_profiles` as the only persisted route
     source of truth and define `requested_model`, `effective_model`, and
     `model_source` in the derived read model.
   - Validation: explicit model, model alias, and adapter/runner default cases
     resolve deterministically, and no independent execution-config store is
     introduced.
2. **Define the local readiness and evidence boundary.**
   - Purpose: report machine readiness without leaking credentials or writing
     machine-specific data into portable profiles.
   - Changes: define a derived `execution-profile` read model and a durable
     `execution-readiness-report`; keep machine-local runner/auth/readiness
     summaries in the W61-S02 persistent Workspace registry, with no credential
     values and no second execution-config or readiness store.
   - Validation: contract, examples, schemas, redaction tests, and invalid
     fixtures cover `unconfigured`, `runner-missing`, `auth-missing`,
     `model-unsupported`, `capability-mismatch`, `policy-denied`, `ready`, and
     `stale`.
3. **Add revisioned CLI route management.**
   - Purpose: make approved route setup headless and automatable before UI use.
   - Changes: add `aor route show`,
     `aor route select --step <step> --route <route_id> --expected-revision <ref>`,
     `aor route reset --step <step> --expected-revision <ref>`, and
     `aor route check [--step <step>]` to the canonical command catalog.
   - Validation: command help, parsing, stale revision, unknown route/step,
     active-run conflict, redaction, and deterministic output fixtures pass.
4. **Add canonical API actions and read behavior.**
   - Purpose: give the web console the same bounded operations without raw
     profile editing.
   - Changes: add
     `GET /api/projects/:projectId/execution-profile` and
     `POST /api/projects/:projectId/execution-profile/actions` with typed
     `select`, `reset`, and `check` actions; `select` and `reset` create a
     revisioned project-profile mutation while `check` writes readiness
     evidence.
   - Validation: OpenAPI, module, detached HTTP, and CLI fixtures agree; GET is
     non-materializing and neither GET nor an invalid action invokes a runner.
5. **Enforce route, run, and credential safety.**
   - Purpose: prevent setup from bypassing approved policy or mutating an active
     execution.
   - Changes: reject raw provider/model strings outside approved route profiles,
     block route changes during an active run, keep credentials outside API,
     DOM, logs, and evidence, and expose typed recovery actions from the W58-S06
     error envelope.
   - Validation: unsupported model, missing runner/auth, policy denial,
     concurrent revision, wrong-project access, and secret-canary tests fail
     closed before provider spawn.

### Acceptance criteria

1. Project route defaults remain portable project-profile data; the W61-S02
   persistent Workspace registry is the only machine-local store and contains
   runner/auth/readiness summaries without credential values.
2. The CLI and API expose equivalent show/select/reset/check behavior using
   approved route IDs and revision protection.
3. The execution-profile read reports runner, provider, requested/effective
   model, model source, capabilities, fallback summary, and readiness state.
4. GET is non-materializing, `check` writes durable readiness evidence, and
   `select`/`reset` write revisioned profile evidence.
5. Unsupported model, missing runner/auth, policy denial, and active-run route
   changes block before provider invocation with typed recovery context.
6. Existing project profiles and repo-attached launch behavior remain
   backward-compatible when no explicit route is selected.

### Done evidence

- execution-profile and execution-readiness contracts and canonical examples
- CLI catalog and API/OpenAPI request/response fixtures
- revision, active-run, unsupported-model, and policy-denial tests
- non-materializing GET and durable readiness-report evidence
- cross-surface redaction and no-provider-spawn proof

### Out of scope

- Arbitrary provider or model strings outside approved route profiles.
- Credential storage or secret editing in the browser.
- Certifying every live provider/model combination.
- Per-run scheduling or multirepo execution DAGs.

---

## W61-S07 — Execution Setup UX and browser proof

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Installed users can select an approved execution route, inspect
  the effective runner/provider/model, check readiness, and recover from setup
  blockers without editing raw profiles or mistaking simulation for live work.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/web/**`, `apps/api/**`, execution-profile/readiness
  fixtures, browser tests, product and operator guidance
- **Hard dependencies:** W61-S04, W61-S06
- **Primary user story surfaces:** PBO-09, PBO-10, OPS-03, OPS-10, OPS-11.

### Local tasks

1. **Add the project-scoped Execution Setup surface.**
   - Purpose: make execution configuration discoverable before an operator
     reaches a provider-dependent action.
   - Changes: show approved route presets, mode, runner, provider,
     requested/effective model, model source, capabilities, fallback summary,
     qualification, and current readiness for the selected Project and step.
   - Validation: empty, loading, ready, stale, partial, permission, and error
     fixtures render without exposing raw profile or secret values.
2. **Implement approved route selection and reset.**
   - Purpose: let users make the same bounded revisioned choice as CLI/API.
   - Changes: select only route IDs returned by the execution-profile read,
     preview project/step scope and write effects, send expected revision, and
     support reset to the inherited project default.
   - Validation: stale revision, wrong project, active run, unsupported route,
     cancel, retry, reload, and project-switch tests preserve isolation and do
     not issue duplicate mutations.
3. **Implement explicit readiness checking and recovery.**
   - Purpose: explain why execution cannot start and give one safe next action.
   - Changes: add `Check setup`; distinguish missing runner, missing auth,
     unsupported model, capability mismatch, policy denial, and stale readiness
     with typed recovery actions from the canonical error/readiness contract.
   - Validation: blocked setup never invokes a provider, recovery labels match
     their side effects, and durable readiness evidence remains inspectable
     after reload.
4. **Make simulation and live readiness truthful.**
   - Purpose: prevent mock execution from being presented as real model work.
   - Changes: label mock/deterministic routes as simulation, require successful
     preflight before a live route appears ready, and keep advanced per-step
     overrides behind progressive disclosure.
   - Validation: browser assertions fail if simulation is labelled live, a live
     route appears ready without preflight, or an arbitrary model string can be
     submitted.
5. **Prove accessibility, persistence, redaction, and compatibility.**
   - Purpose: close setup as an installed-user task rather than a settings mock.
   - Changes: add keyboard/focus/live-status coverage, responsive fixtures,
     restart/reload readback, secret canaries, and the existing repo-attached
     `cd <repo> && aor app` compatibility scenario.
   - Validation: route selection and readiness recover after reload, no secret
     reaches the DOM/API/evidence bundle, and existing single-repo launch still
     reaches the same Project.

### Acceptance criteria

1. Execution Setup shows the approved route, runner, provider,
   requested/effective model, model source, capabilities, and readiness.
2. Users select an approved route preset rather than an arbitrary model string.
3. Mock/deterministic routes are labelled as simulation, and live routes cannot
   appear ready before successful preflight.
4. Missing runner, missing auth, unsupported model, capability mismatch, and
   policy denial expose distinct, truthful recovery actions.
5. A blocked or invalid setup does not invoke the provider or create duplicate
   profile/readiness evidence.
6. Route choice and readiness survive reload without exposing credentials, and
   existing repo-attached launch remains compatible.

### Done evidence

- Execution Setup UI and project-scoped state ownership map
- route selection/reset/check browser side-effect assertions
- readiness blocker and recovery fixture matrix
- reload/restart, accessibility, responsive, and project-isolation evidence
- secret-canary and no-provider-spawn proof
- installed single-repo compatibility transcript

### Out of scope

- Free-form provider/model configuration.
- Browser credential entry or storage.
- Paid external calls as a required acceptance dependency.
- Multirepo run scheduling or coordinated delivery.
