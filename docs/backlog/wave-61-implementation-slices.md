# W61 - project topology, bindings, and management UX

W61 makes single-repo, monorepo, and bounded multirepo projects configurable
through portable project definitions plus machine-local bindings. It extends
the local project switcher into explicit Project Structure management while
preserving independent runtime/flow state for separate AOR projects.

## Wave objective

Repository owners and installed users can create, validate, rebind, inspect,
and safely evolve project topology without editing raw YAML or leaking local
paths into portable project profiles.

## Wave exit criteria

- Product and architecture distinguish Local Workspace, AOR Project,
  Repository, Component, Project Binding, and Workspace Set.
- `project-profile` represents repositories and optional components without
  treating monorepo packages as separate Git repositories.
- A persistent operator-local registry survives app restart and stores
  machine-local bindings outside target project profiles.
- CLI/API/UI support explicit repository/component add, edit, rebind, disable,
  reanalyze, and validate flows with project-scoped authorization.
- The Add Project flow and Project Structure cover loading, empty, partial,
  invalid, dirty, unavailable, ref-drift, permission, and recovery states.
- Single-project `cd <repo> && aor app` and existing project profiles remain
  backward-compatible.

---

## W61-S01 — Project topology and local binding contract baseline

- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-2 Packet lifecycle;
  EPIC-5 Delivery and release
- **State:** blocked
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
- **State:** blocked
- **Outcome:** Persist explicitly connected projects and repository bindings,
  then analyze repositories/components without automatic filesystem discovery.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/cli/**`,
  `apps/api/**`, local registry and project-analysis tests
- **Hard dependencies:** W61-S01
- **Primary user story surfaces:** PBO-01, PBO-03, PBO-07, PBO-08, RMO-01, RMO-02.

### Local tasks

1. **Choose and implement the operator-local registry store.**
   - Purpose: preserve explicitly added projects across `aor app` restarts
     without writing machine-local metadata into target repositories.
   - Changes: add one default local workspace registry under AOR-owned user
     state, atomic writes, versioning, locking, corruption recovery, and an
     explicit ephemeral mode for tests.
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
     runtime roots/project IDs isolated, and add opt-in persistence semantics.
   - Validation: current app-config, project index, duplicate/collision, and
     two-project isolation tests remain valid.

### Acceptance criteria

1. Explicitly added projects and bindings survive app restart.
2. Registry reads do not scan the filesystem or initialize `.aor/`.
3. Discovery proposals include source/confidence evidence and require approval.
4. Unavailable or invalid repositories keep the project inspectable and expose
   recovery actions.
5. Existing one-project launch and W36 isolation remain compatible.

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
- **State:** blocked
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
   - Changes: add project create/import, repo/component list/add/update/disable,
     binding rebind, dependency update, reanalyze, and validate command/API
     semantics with compatibility wrappers for current add-project behavior.
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
     existing lifecycle commands, and default single-repo behavior.
   - Validation: existing HTTP/app smoke tests pass alongside new management tests.

### Acceptance criteria

1. All topology and binding mutations are available headlessly before UI use.
2. Material topology changes write revision evidence and invalidate stale plans.
3. Validation reports provide stable blocker codes and recovery actions.
4. Project/auth/redaction boundaries fail closed without state leakage.
5. Existing app launch/add-project APIs remain compatible.

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
- **State:** blocked
- **Outcome:** Let installed users configure and recover project topology through
  an accessible setup flow and project-scoped management surface.
- **Primary modules:** `apps/web/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/product/**`, browser tests
- **Hard dependencies:** W61-S03
- **Primary user story surfaces:** PBO-01, PBO-03, PBO-08, PBO-09, RMO-01,
  RMO-02, OPS-01, OPS-10.

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
   - Changes: add Identity, Topology, Repositories, Components, Dependencies,
     and Review steps with back navigation, dirty-draft confirmation, validation,
     and explicit initialize.
   - Validation: opening or validating never initializes runtime state; keyboard
     and focus order remain deterministic.
3. **Implement Project Structure management.**
   - Purpose: make topology health and common actions scannable for repeated use.
   - Changes: add Overview, Repositories, Components, Dependencies, and
     Validation views with add/edit/rebind/disable/reanalyze actions and raw refs
     behind secondary details.
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
   - Validation: two-project tests prove forms, flow, evidence, topology, and
     runtime state do not leak.

### Acceptance criteria

1. Users can configure all supported topologies without editing YAML.
2. Setup distinguishes portable profile data from machine-local bindings.
3. Initialization and destructive changes are explicit and preview write effects.
4. Project Structure provides readable management and recovery for required states.
5. The UI is keyboard-complete, responsive, accessible, and project-isolated.

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
- **Outcome:** Prove project topology setup and management through installed-user
  and headless paths while preserving current no-settings compatibility.
- **Primary modules:** `README.md`, `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`,
  `scripts/live-e2e/**`, root checks
- **Hard dependencies:** W61-S04
- **Primary user story surfaces:** PBO-08, PBO-09, RMO-01, RMO-02, OPS-06, OPS-10.

### Local tasks

1. **Build topology fixtures and installed-user scenarios.**
   - Purpose: cover single-repo compatibility, monorepo components, and bounded
     multirepo bindings through public surfaces.
   - Changes: add disposable targets/profiles and explicit local binding setup
     without relying on filesystem scan or private repositories.
   - Validation: fixtures remain no-write unless a later delivery proof says otherwise.
2. **Exercise persistence and recovery.**
   - Purpose: prove registry restart, unavailable repository, rebind, ref drift,
     validation, and disabled-component behavior.
   - Changes: capture before/after registry/profile/binding/report evidence.
   - Validation: recovery does not lose unrelated project/flow state.
3. **Run browser-task UX assessment.**
   - Purpose: validate setup comprehension and repeated management work.
   - Changes: capture keyboard, focus, responsive, accessibility, task outcome,
     screenshots, and UX findings for all three topologies.
   - Validation: graph-independent dependency editing and blocker recovery pass.
4. **Refresh documentation and compatibility claims.**
   - Purpose: make installed-user and headless guidance match implementation.
   - Changes: update README, onboarding journey, project description, contracts,
     command/API docs, runbooks, and examples.
   - Validation: docs distinguish one bounded multirepo project from several
     independent project IDs in the local workspace.
5. **Classify findings and run gates.**
   - Purpose: close the wave with reviewable proof rather than screenshots alone.
   - Changes: classify findings, create follow-up slices, run root/slice gates,
     and verify local bindings/runtime state are not committed.
   - Validation: W61 closure has public proof refs and clean repository status.

### Acceptance criteria

1. Public proof covers single-repo, monorepo, and bounded multirepo onboarding.
2. Persistent registry and rebind/recovery behavior survive restart.
3. Browser proof covers accessibility, responsive layout, and project isolation.
4. Documentation accurately separates profile, binding, workspace, and project ID.
5. No local binding, credential, or runtime state is committed.

### Done evidence

- topology fixtures and installed-user proof refs
- persistence/recovery and browser-task evidence
- updated docs/contracts/runbooks/examples
- passing root and slice gates

### Out of scope

- Parallel execution.
- Coordinated write-back proof.
- Publishing a release.
