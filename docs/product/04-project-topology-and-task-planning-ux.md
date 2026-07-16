# Project topology and task planning UX

## Purpose

This document defines the operator experience for planning detailed work and
managing single-repo, monorepo, and bounded multirepo AOR projects. It extends
the flow-centric console without making the web app an orchestration owner.

The product outcome is that an operator can connect the real repository
topology, review an execution-ready task plan, approve bounded scope, observe
sequential or parallel execution, and recover from partial failure without
reading or editing raw runtime JSON.

The adopted console target in `05-quiet-cockpit-console-design.md` places the
Plan, Execution, Integration, and coordinated-delivery content from this
document inside the flow-scoped Journey mode. Quiet Cockpit remains the default
home and shows only the current state and one safe action. Journey graphs remain
specialist inspection views: the dense task table, dependency list, and
accessible status/recovery alternatives defined here are still required.

## Product brief

- **Product type:** local developer and SDLC operations tool.
- **Primary platform:** packaged responsive web console launched by `aor app`,
  with equivalent CLI and API behavior.
- **Primary users:** repository owners, engineering managers, planners,
  delivery engineers, reviewers, QA users, and operators.
- **Primary job:** turn one approved product outcome into a bounded,
  understandable, and evidence-backed execution across the correct repositories
  and components.
- **Safety constraints:** headless-first ownership, no implicit filesystem
  scanning, no upstream writes by default, immutable approved plans, isolated
  delivery-capable execution, and no machine-local paths in portable profiles.
- **Success signals:** topology is valid, task scope is complete, the next safe
  action is obvious, task status is evidence-derived, and partial execution has
  an explicit recovery path.

## Product vocabulary

- **Local workspace:** operator-local registry of explicitly connected AOR
  projects. It is not a cross-project portfolio transaction.
- **AOR project:** one product or coordinated SDLC boundary with one runtime and
  flow history.
- **Repository:** one physical Git repository participating in the project.
- **Component:** one application, service, package, or bounded path inside a
  repository.
- **Project binding:** machine-local mapping from portable repository identity
  to a local checkout or clone source.
- **Task plan:** approved structured tasks derived from specification and
  project analysis.
- **Execution unit:** scheduler-owned grouping of one or more approved tasks.
- **Run attempt:** one bounded attempt to execute an execution unit.
- **Workspace set:** run-scoped isolated checkouts for all participating
  repositories.

Packages in a monorepo are components, not fake repositories. Separate backend,
frontend, and mobile repositories remain repositories inside one AOR project
when they share mission, acceptance, and delivery coordination.

## Users and top jobs

| User | Top jobs |
|---|---|
| Repository owner | Connect repositories, define components and dependencies, validate refs and commands, and resolve path or binding failures. |
| Engineering manager / planner | Review detailed tasks, dependencies, scope, acceptance coverage, and safe parallel candidates before approval. |
| Delivery engineer | Execute approved work in isolated workspaces, inspect changed paths and verification by repository, and retry only failed work. |
| Reviewer / QA | Trace each task and top-level acceptance criterion to implementation, verification, and integration evidence. |
| Operator / SRE | See one next action, current blockers, stale work, active attempts, and recovery actions without raw artifact inspection. |

## Information architecture

The top-level object remains the selected AOR project. The flow remains the
primary lifecycle object inside that project.

1. **Project switcher** - switch independent AOR projects and show topology,
   repository readiness, runtime root, and active-flow summary.
2. **Project Structure** - manage repositories, components, dependencies,
   bindings, commands, and validation.
3. **Flow Plan** - inspect proposed or approved tasks, traceability, execution
   units, dependencies, and verification.
4. **Execution** - inspect parent run, child attempts, parallel lanes,
   integration gate, stale tasks, and blockers.
5. **Review and Delivery** - inspect aggregate acceptance, per-repository
   delivery state, coordination evidence, and recovery actions.

Project Structure is project-scoped. Flow Plan and all later views are
flow-scoped. Switching projects must clear flow, task, run, evidence, and form
state before loading the next project.

## Main journey

1. The operator launches `aor app` and selects an existing project or chooses
   **Add AOR Project**.
2. The setup flow captures project identity and selects `single-repo`,
   `monorepo`, or `bounded-multirepo`.
3. The operator explicitly adds local paths or Git sources. AOR validates each
   source without initializing unrelated repositories or scanning the machine.
4. AOR proposes components and dependency edges from deterministic project
   analysis. The operator can edit the proposal before initialization.
5. The review step shows the portable project profile separately from
   machine-local bindings and previews runtime write effects.
6. After initialization, Project Structure shows repository and component
   health. Blocking configuration errors prevent execution but remain
   recoverable through rebind, edit, reanalyze, or disable actions.
7. A mission advances through discovery and specification. Planning proposes a
   versioned task plan with bounded scope and acceptance traceability.
8. The operator reviews task details, dependency order, candidate parallelism,
   verification, expected evidence, and uncovered criteria.
9. Approval freezes the plan version. Material changes create a new revision
   and invalidate approval instead of silently mutating the approved plan.
10. Execution provisions a workspace set and runs ready execution units.
    Independent units may run in parallel only after deterministic conflict
    checks pass.
11. Integration, review, and QA aggregate task and repository evidence.
    Delivery remains blocked while required tasks are incomplete, stale, or
    failed.
12. Coordinated delivery shows one row per repository, aggregate readiness,
    partial-delivery recovery, and the exact next safe action.

## Screen inventory

### Add project flow

The existing add-project drawer becomes a focused setup flow with these steps:

1. **Project identity:** display name, stable project ID, runtime root, and
   existing-profile import.
2. **Topology:** single repository, monorepo, or bounded multirepo, with concise
   consequences rather than implementation tutorials.
3. **Repositories:** path/source, repository ID, role, default ref, and binding
   status. Bounded multirepo supports add, edit, reorder, and disable.
4. **Components:** detected apps/services/packages with repository, role, root,
   and command overrides.
5. **Dependencies:** component and cross-repository edges plus integration
   validation refs.
6. **Review:** portable profile preview, machine-local binding summary,
   validation findings, and explicit initialize action.

The primary action advances one step. Back preserves entered values. Closing a
dirty draft asks for confirmation. Initialization is never triggered by merely
opening, validating, or navigating the flow.

W61-S04 implements this baseline in the installed SPA. The setup dialog owns
the six-step portable-topology review, keeps machine-local binding information
separate, and exposes initialization only as an explicit confirmed action.
Project Structure reads remain non-materializing when the approved profile is
absent and return a stable empty model rather than creating `.aor`.

### Project Structure

Project Structure uses compact tabs or equivalent navigation:

- **Overview:** topology, repository/component counts, validation summary,
  runtime root, and current blockers.
- **Repositories:** source, role, branch/ref, dirty state, binding state,
  commands, active run conflicts, and row actions.
- **Components:** component root, role, owning repository, commands, and
  dependency count.
- **Dependencies:** scannable edge list as the default, with a graph as a
  secondary inspection view.
- **Validation:** deterministic checks, affected scope, evidence refs, and
  recovery actions.

Destructive removal is replaced by disable/deprecate when historical evidence
references the repository or component. Raw paths and refs are secondary debug
details, not primary labels.

The W61-S04 implementation provides Overview, Repositories, Components,
Dependencies, and Validation views through the canonical topology API.
Repository and component disable actions show a write-effect confirmation;
validation, refresh, and navigation remain read-only with respect to project
runtime state.

### Execution Setup

W61-S06 provides the headless contract and control-plane baseline used by the
installed UI. `project-profile.default_route_profiles` remains the only
persisted route selection. `execution-profile` derives approved route, runner,
provider, requested/effective model, model source, capabilities, fallback, and
readiness without exposing credentials or initializing `.aor`.

CLI and API support show, revisioned select/reset, and explicit check. Check
persists only runner/auth availability summaries in the Local Workspace
registry and fails closed before provider spawn for missing runner/auth,
unsupported model, capability mismatch, or policy denial.

W61-S07 adds the project-scoped Execution Setup browser surface. It lists only
approved route IDs returned by the canonical read model, labels deterministic
routes as simulation, previews revisioned route changes, and requires explicit
readiness checking before live execution is presented as ready. Project
switches abort or ignore stale reads and mutations; no browser field accepts
provider, model, credential, or environment values.

### Flow Plan workbench

The default view is a dense task table with columns for task, type, scope,
dependencies, status, verification, and blocking state. Selecting a row opens a
detail drawer with objective, rationale, work items, acceptance criteria,
expected evidence, risks, execution hints, and attempt history.

The workbench also exposes:

- a dependency view for ready, blocked, and parallel-candidate tasks;
- an acceptance traceability view mapping Goal, KPI, Definition of Done, and
  acceptance criteria to tasks and evidence;
- a plan revision diff showing added, removed, widened, narrowed, and reordered
  task scope;
- approve, request revision, and no-write explain actions through control-plane
  mutations.

There is no manual **Mark complete** action for normal runtime tasks. Completion
is derived from accepted evidence. Manually supplied external evidence requires
an explicit audited decision.

### Execution view

The execution stage shows the parent run first, then execution units grouped by
dependency lane. Each unit displays task refs, repository/component scope,
attempt number, provider status, changed paths, verification, and blocker.

Parallel lanes must remain readable without implying that all tasks run in
parallel. The UI labels scheduler decisions as `sequential`,
`parallel-candidate`, `parallel-approved`, or `serialized-by-conflict`, with a
short reason available in details.

### Integration and delivery view

Integration shows applied child outputs, merge/conflict state, cross-repository
validation, stale downstream tasks, review/QA status, and retry/repair actions.

Delivery shows one repository row per coordinated write-back result and one
aggregate transaction status. Partial delivery never appears successful. The
operator sees which repositories completed, which failed, what was written,
which locks remain active, and the recovery or rollback action.

## State and recovery matrix

| State | UI behavior | Recovery |
|---|---|---|
| Empty workspace | Show one Add project action and no invented sample project. | Add an explicit path/source or import a profile. |
| Uninitialized project | Show detected context and write-effect preview. | Initialize explicitly. |
| Repository unavailable | Keep project readable and block affected execution. | Rebind, retry validation, or disable for future flows. |
| Dirty repository | Show changed-file count and policy consequence. | Continue only in allowed no-write mode, clean externally, or use isolated clone policy. |
| Ref drift | Mark affected plan/workspace stale before execution. | Refresh analysis and create a new plan revision. |
| Invalid component root | Fail validation with repository and path context. | Edit component root or remove the proposal. |
| Incomplete task plan | Show uncovered criteria and disable approval. | Request planner revision or edit through an audited mutation. |
| Active attempt | Disable conflicting mutations and show heartbeat. | Pause, cancel, answer, or inspect according to run policy. |
| Child run failed | Preserve successful evidence; block integration. | Retry or repair the failed execution unit. |
| Downstream task stale | Keep previous attempt visible but non-acceptable. | Replan or rerun from the invalidated boundary. |
| Integration conflict | Show affected repositories/files and retain workspace. | Resolve through bounded repair or operator hold. |
| Partial delivery | Show aggregate failure and per-repository write effects. | Follow explicit recovery/rollback plan; never auto-complete. |
| App disconnected | Keep last safe read state visibly stale and disable mutations. | Reconnect and refresh control-plane state. |
| Permission denied | Explain the missing scope without exposing secrets. | Change authorized configuration outside the UI or use an allowed action. |

## Interaction rules

- Validate paths and IDs on blur and again on submit; remote or expensive checks
  run only after explicit validation.
- Preserve keyboard focus inside drawers and setup steps, return focus to the
  triggering control on close, and announce validation summaries.
- Use one primary action per setup or approval state. Secondary actions must not
  visually compete with the next safe action.
- Confirm removal, disabling, plan revision discard, cancellation, and partial
  delivery recovery when they can invalidate work or evidence.
- Approved plan versions and completed flows are read-only. Revision creates a
  new version with a visible diff.
- Repository, component, task, execution-unit, and run-attempt statuses must use
  different labels; do not collapse all of them into `running` or `done`.
- Loading, empty, partial, stale, blocked, permission, disconnected, and error
  states are first-class and must not fall back to blank panels.
- CLI and API expose every mutation before the UI depends on it.

## Accessibility and responsive behavior

- All setup, task review, approval, and recovery flows must be keyboard
  complete with visible focus and deterministic focus order.
- Status cannot rely on color alone; each status uses text and an icon or other
  non-color signal.
- Tables provide meaningful row labels and remain usable at narrow widths by
  moving secondary columns into row details rather than horizontal overflow.
- Dependency graphs are secondary; every dependency and blocker is available
  in an accessible list or table.
- Long repository names, paths, refs, task titles, and blocker messages wrap or
  truncate with accessible full-text details and never overlap controls.

## Risks

- Treating components as repositories would break monorepo delivery semantics.
- Persisting absolute local paths in project profiles would leak machine-local
  data and make profiles non-portable.
- Showing proposed parallelism as guaranteed could create unsafe expectations.
- Allowing UI-only plan edits would break headless parity and audit lineage.
- A single generic status for task, unit, attempt, and run would make retry and
  recovery ambiguous.
- Adding all new views directly to the current monolithic SPA module would
  increase implementation risk; feature modules should be extracted during
  implementation without changing current behavior first.

## Acceptance criteria

1. A user can create and initialize single-repo, monorepo, and bounded
   multirepo projects without raw YAML editing.
2. Portable profile data and machine-local bindings are visibly distinct and
   persisted in their owning stores.
3. Project Structure makes repository, component, dependency, and validation
   state inspectable and recoverable.
4. Medium+ task plans expose bounded scope, work items, dependencies,
   acceptance criteria, verification, expected evidence, and risks.
5. Plan approval is blocked by incomplete traceability or invalid scope and is
   invalidated by material revision.
6. Task completion is evidence-derived, while reruns create attempts under the
   same stable task ID.
7. Parallel execution is visible only after deterministic dependency, path,
   conflict-key, policy, and isolation checks pass.
8. Partial child-run, integration, and delivery failures have explicit
   operator-visible recovery paths.
9. All UI behavior is available through headless CLI/API/control-plane paths.
10. Browser proof covers keyboard operation, responsive behavior, readable
    states, no state leakage between projects/flows, and no upstream writes by
    default.

## Open questions

- Whether the first persistent local workspace registry should support named
  workspaces or only one default workspace. The conservative first release uses
  one default workspace with explicit projects.
- Whether component dependency editing needs a primary graph editor. The
  conservative first release uses a list/table editor and keeps the graph
  read-only and secondary.
- Whether one physical monorepo may be write-enabled from multiple independent
  AOR projects. The conservative first release requires non-overlapping scopes
  plus workspace-level conflict evidence, otherwise non-`no-write` execution is
  blocked.

## Backlog and contract handoff

- W60 implements structured task plans, completeness, semantic evaluation,
  exact-version approval, evidence-derived progress, and the Flow Plan
  workbench.
- W61 owns project/repository/component/binding contracts, local persistence,
  topology management, and Project Structure UX.
- W62 owns workspace sets, impact DAGs, parent/child execution, integration,
  repair, coordinated delivery, and end-to-end proof.
- W60 planning was requalified after W59 audit closure with headless, API, and
  installed-browser evidence. This does not imply W61 topology management or
  W62 parallel/multirepo execution readiness.
- W45 quality repair state is reused for failed or stale execution units rather
  than replaced by a second repair model.
