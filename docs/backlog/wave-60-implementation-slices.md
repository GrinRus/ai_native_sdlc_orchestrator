# W60 - structured task planning and operator workbench

W60 replaces generic implementation/verification task lists with structured,
versioned, execution-ready plans. It preserves the shared backlog rule that a
slice normally contains three to seven local work packages while making each
runtime task complete enough for another agent, reviewer, or operator to act
without rediscovering scope and acceptance decisions.

Commit `392f94c` landed a substantial provisional implementation of W60-S01
through W60-S04 before their W59-S07 entry dependency closed. The code and docs
are useful characterization input, but every W60 slice remains `blocked`: work
must requalify the baseline against post-W57/W59 contracts and quality ratchets,
close residual gaps, and collect the owning slice evidence before any state or
story claim can advance.

## Wave objective

Engineering managers, planners, delivery engineers, and reviewers can inspect
and approve detailed task plans whose scope, dependencies, verification,
evidence, and completion state remain traceable through execution attempts.

## Wave exit criteria

- `wave-ticket` and `handoff-packet` define an additive structured task model
  with backward-compatible loading for current task records.
- Medium+ plans cannot reach approval with orphaned criteria, invalid scope,
  cyclic dependencies, or missing verification/evidence expectations.
- Planning no longer emits only the hardcoded implementation, verification,
  and lineage task trio for every mission.
- `execution-plan` and task-progress evidence distinguish stable tasks,
  execution units, run attempts, and evidence-derived completion.
- CLI/API/web expose plan revisions, task details, traceability, blockers, and
  approval without introducing UI-owned orchestration state.
- Browser and headless proof cover small compatibility plus one medium+ plan
  with a failed/retried attempt under the same task ID.

---

## W60-S01 — Structured task contract and backlog detail baseline

- **Epic:** EPIC-0 Repository development system; EPIC-2 Packet lifecycle;
  EPIC-4 Quality platform
- **State:** done
- **Outcome:** Define the source-of-truth structured task shape, completeness
  policy, and contributor planning format before planner/runtime behavior
  depends on them.
- **Primary modules:** `docs/product/**`, `docs/contracts/**`,
  `docs/backlog/**`, `packages/contracts/**`, `examples/packets/**`,
  `.agents/skills/backlog-workflow/**`, tests
- **Hard dependencies:** W59-S07
- **Primary user story surfaces:** EMP-01, EMP-02, ARC-05, PSO-07, OPS-10.

### Local tasks

1. **Define task ownership and terminology.**
   - Purpose: separate backlog local tasks, runtime plan tasks, execution units,
     and run attempts so status and rerun semantics are unambiguous.
   - Changes: update product, operating-model, `wave-ticket`, and
     `handoff-packet` guidance with stable IDs, plan versions, and ownership.
   - Validation: terminology is consistent across product, architecture,
     contracts, examples, and backlog docs.
2. **Specify the additive structured task record.**
   - Purpose: make every medium+ task execution-ready without requiring a
     second undocumented planning pass.
   - Changes: define title, type, objective, rationale, scope, dependencies,
     work items, criteria IDs, verification, expected evidence, risks, and
     execution hints; retain compatibility with existing minimal objects.
   - Validation: old packet fixtures load unchanged and new complete/incomplete
     fixtures produce deterministic results.
3. **Define deterministic completeness and traceability checks.**
   - Purpose: block structurally incomplete plans before any evaluator judges
     semantic quality.
   - Changes: specify unique IDs, bounded-scope subset checks, DAG validity,
     Goal/KPI/DoD/criterion coverage, verification coverage, and evidence
     ownership; split the provisional structured-task validator into focused
     shape, scope, DAG, coverage, and evidence checks that satisfy W59 ceilings.
   - Validation: fixtures cover orphan criterion, unknown dependency, cycle,
     scope widening, missing verification, and valid small/medium plans.
4. **Upgrade task detail and semantic backlog integrity.**
   - Purpose: keep shared slices readable while carrying enough implementation
     context for handoff and prevent planning sources from agreeing only on IDs.
   - Changes: require three to seven work packages with Purpose, Changes, and
     Validation for new medium+ slices; make `slice:plan` preserve multiline and
     nested detail losslessly; verify title, epic membership, dependencies,
     acyclic/topological order, roadmap detail/allocations, and owning-wave
     metadata across master/roadmap/epic/graph sources; update W63-W65 to the
     convention without rewriting historical done waves.
   - Validation: parser round-trip fixtures retain Purpose/Changes/Validation;
     deliberate title, epic, cycle/order, missing-wave-detail, allocation, and
     task-shape drift each fail with an actionable source location.
5. **Register examples, migration notes, and contract validation.**
   - Purpose: make compatibility and adoption reviewable before runtime changes.
   - Changes: add current-minimal, structured-medium, and structured-multirepo
     packet examples plus migration and versioning notes.
   - Validation: contract/reference tests pass and no existing example becomes
     invalid solely because new optional fields exist.

### Acceptance criteria

1. Source-of-truth docs distinguish slice, task, execution unit, and attempt.
2. Medium+ structured task fields and deterministic completeness checks are
   documented with canonical examples.
3. Existing wave tickets and handoff packets remain loadable without migration.
4. New backlog slices use detailed work packages without turning subtasks into
   shared slice records.
5. Validation runs before any optional semantic task-quality evaluation.
6. Backlog helpers preserve complete local-task detail and fail semantic drift
   across the master backlog, roadmap, wave docs, epic map, and dependency graph.

### Done evidence

- updated contracts, product guidance, backlog operating model, and skill
- canonical minimal/medium/multirepo packet examples
- contract loader and task-completeness fixture tests
- `pnpm slice:plan -- W60-S02`

### Out of scope

- Planner runtime changes.
- Task progress or execution scheduling.
- Rewriting completed wave documents.

---

## W60-S02 — Planner decomposition and task quality gate

- **Epic:** EPIC-2 Packet lifecycle; EPIC-3 Routed execution; EPIC-4 Quality platform
- **State:** ready
- **Outcome:** Generate mission-specific structured tasks from current planning
  evidence instead of the generic implementation/verification/lineage fallback.
- **Primary modules:** `examples/prompts/**`, `examples/context/**`,
  `packages/orchestrator-core/src/handoff-packets.mjs`,
  `packages/contracts/**`, planning tests
- **Hard dependencies:** W60-S01, W44-S03
- **Primary user story surfaces:** EMP-01, EMP-02, DIS-05, ARC-05, PSO-07.

### Local tasks

1. **Define planner inputs and decomposition rules.**
   - Purpose: ground tasks in approved specification, project analysis, repo
     scope, acceptance intent, and current readiness evidence.
   - Changes: document required/optional inputs and rules for small, medium, and
     multirepo missions, including when a mission must be split instead.
   - Validation: planner fixtures show which source evidence produced each task.
2. **Upgrade planner prompt and runtime context.**
   - Purpose: require actionable task records rather than a prose-only wave
     plan.
   - Changes: add required task sections, traceability, dependency, scope,
     verification, risk, and stop-condition guidance to planner assets.
   - Validation: compiled context preserves prompt/context provenance and the
     new task requirements under existing runner-agnostic routing.
3. **Replace hardcoded generic task materialization.**
   - Purpose: make runtime packet output reflect actual mission decomposition.
   - Changes: normalize planner-produced tasks, retain a small-mission fallback,
     stop generating the same three tasks for every medium+ mission, and separate
     plan candidate/materialization responsibilities from the provisional
     `handoff-packets.mjs` service behind focused interfaces.
   - Validation: tests cover small fallback, medium task plan, multirepo scope,
     duplicate IDs, invalid dependencies, and missing required content.
4. **Add task completeness and semantic quality decisions.**
   - Purpose: enforce structural checks first and use evaluation only for
     actionability or granularity concerns that cannot be deterministic.
   - Changes: materialize readable findings, blocker codes, and revision advice
     for failed plans.
   - Validation: structurally invalid plans never reach evaluator/approval;
     evaluator failure remains evidence-backed and bounded.
5. **Preserve planning revision lineage.**
   - Purpose: make regenerated plans auditable and prevent silent approved-plan
     mutation.
   - Changes: record source refs, previous plan ref, change reason, task diff
     summary, and material-change classification.
   - Validation: unchanged regeneration is idempotent; material scope/dependency
     changes create a new revision and require approval.

### Acceptance criteria

1. Medium+ planning produces mission-specific tasks with stable IDs and source
   traceability.
2. Small missions remain compatible with a compact bounded task plan.
3. Invalid scope, dependency, criteria coverage, or verification blocks handoff
   approval deterministically.
4. Task quality evaluation cannot bypass deterministic validation.
5. Material replanning creates a new version and records a readable diff.
6. Planning-specific services and extracted functions satisfy the W59-S04 size,
   complexity, nesting, duplication, and dead-export ratchets.

### Done evidence

- planner prompt/context updates
- runtime task materialization and validation tests
- small, medium, incomplete, and multirepo planning fixtures
- plan revision/diff evidence

### Out of scope

- Executing tasks independently.
- Web task workbench.
- Cross-project planning transactions.

---

## W60-S03 — Execution plan and evidence-derived task progress

- **Epic:** EPIC-2 Packet lifecycle; EPIC-3 Routed execution; EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Add a durable execution plan and progress projection that map
  stable tasks to execution units, attempts, verification, and completion.
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`,
  `packages/orchestrator-core/**`, `packages/observability/**`,
  `examples/reports/**`, tests
- **Hard dependencies:** W60-S02
- **Primary user story surfaces:** EMP-02, EMP-03, EMP-07, DEV-05, OPS-01, OPS-10.

### Local tasks

1. **Define execution-plan and progress contracts.**
   - Purpose: make task-to-run mapping durable and queryable.
   - Changes: define plan/task/unit IDs, dependencies, task refs, attempt refs,
     required evidence, integration requirements, and aggregate status.
   - Validation: canonical sequential, grouped, retried, blocked, and completed
     examples validate.
2. **Define separate lifecycle states.**
   - Purpose: prevent plan, task, unit, attempt, and parent run from sharing an
     ambiguous `done` state.
   - Changes: specify plan revision/approval, task readiness/progress, unit
     scheduling, attempt terminal states, and evidence-derived completion.
   - Validation: transition tests reject impossible or backward transitions.
3. **Materialize execution units without equating tasks to runs.**
   - Purpose: allow one run to close coupled tasks and separate runs for
     independently verifiable outcomes.
   - Changes: add grouping rationale, dependency preservation, execution hints,
     and stable task refs to run context and step evidence; extract execution-plan
     materialization from the provisional task-plan service.
   - Validation: fixtures prove one-to-one, many-tasks-to-one-unit, and repeated
     attempts for one unit.
4. **Derive task completion from evidence.**
   - Purpose: prevent runner claims or UI actions from marking work complete.
   - Changes: map criteria, verification, expected evidence, blocking findings,
     and stale state into a focused task-progress read model rather than one
     mixed persistence/projection service.
   - Validation: missing evidence, failed verification, or open blockers keep a
     task non-complete even after a successful adapter response.
5. **Expose headless reads and next-action integration.**
   - Purpose: make UI-independent plan/progress inspection and recovery possible.
   - Changes: add CLI/API/control-plane reads, pagination, unknown-ref handling,
     and one safe next action for blocked or retryable task state; keep internal
     materializers private unless a documented public consumer requires export.
   - Validation: project/flow isolation and auth tests cover task/progress reads.

### Acceptance criteria

1. Stable task IDs survive retries and map to one or more attempt refs.
2. Task completion requires criteria, verification, evidence, and no open
   blocking findings.
3. Execution units may group tasks but cannot drop dependencies or widen scope.
4. Plan/task/unit/attempt states remain distinct in contracts and read models.
5. CLI/API can inspect progress and the next safe action without the web app.
6. Execution-plan, progress, persistence, and read responsibilities are separated
   into focused modules that satisfy the W59-S04 ratchets.

### Done evidence

- execution-plan and task-progress contracts/examples
- transition, grouping, evidence, and isolation tests
- CLI/API/control-plane read examples
- next-action fixtures

### Out of scope

- Parallel scheduler implementation.
- Multirepo workspace provisioning.
- Delivery transaction changes.

---

## W60-S04 — Plan workbench UX and approval flow

- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Make proposed and approved task plans understandable, reviewable,
  and safely revisable in the flow-centric local console.
- **Primary modules:** `apps/web/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/product/**`, control-plane tests
- **Hard dependencies:** W60-S03
- **Primary user story surfaces:** EMP-01, EMP-02, EMP-03, PSO-04, PSO-07,
  OPS-01, OPS-02, OPS-10.

### Local tasks

1. **Extract a plan-workbench feature boundary.**
   - Purpose: avoid adding task management directly to the existing monolithic
     SPA module.
   - Changes: decompose the provisional `PlanWorkbench` into focused task table,
     detail drawer, traceability, and plan-diff modules using existing UI
     conventions and read models; satisfy the W59-S03/W59-S04 ceilings.
   - Validation: behavior-preserving web tests pass before feature behavior is
     added.
2. **Render a scannable task plan.**
   - Purpose: let operators compare scope, dependencies, status, verification,
     and blockers without opening raw packets.
   - Changes: add dense table/list, repository/component scope labels, ready and
     blocked states, and a detail drawer for full task content.
   - Validation: long names/paths and narrow viewports remain readable without
     overlap or uncontrolled horizontal scrolling.
3. **Add acceptance traceability and dependency views.**
   - Purpose: reveal uncovered Goals/KPIs/DoD/criteria and real dependency
     reasons before approval.
   - Changes: add accessible mapping tables and a secondary dependency view;
     graphs never become the only representation.
   - Validation: keyboard and screen-reader tests can reach every criterion,
     task, blocker, and dependency.
4. **Add revision and approval interactions.**
   - Purpose: keep approved plans immutable while allowing bounded correction.
   - Changes: expose request revision, plan diff, approve, no-write explain, and
     approval invalidation through control-plane mutations.
   - Validation: UI cannot silently mutate approved tasks or approve incomplete
     plans; focus and confirmation behavior are deterministic.
5. **Render progress and recovery without manual completion.**
   - Purpose: make attempts, verification-pending, blocked, stale, and complete
     states actionable.
   - Changes: show attempt history and next actions; omit normal manual
     `Mark complete` behavior and require audited external evidence decisions.
   - Validation: project/flow switching clears task state and disconnected or
     permission states disable mutations safely.

### Acceptance criteria

1. Operators can inspect task details, dependencies, criteria coverage,
   verification, evidence, risks, and attempts without raw JSON.
2. Incomplete plans visibly block approval and identify uncovered criteria.
3. Approved plans are read-only; material revisions create a new visible version.
4. Completion is rendered from control-plane evidence, not browser state.
5. Keyboard, focus, responsive, loading, empty, error, permission, and
   disconnected states pass targeted UI tests.
6. The Plan workbench feature boundary meets the W59 complexity/file-size ratchet
   and does not add state or orchestration back into the SPA monolith.

### Done evidence

- extracted plan-workbench modules and tests
- API/control-plane approval/revision tests
- accessibility and responsive browser evidence
- screenshots/DOM evidence for proposed, blocked, approved, and retried plans

### Out of scope

- Visual project-topology management.
- Parallel execution UI.
- Hosted collaboration or multi-user approvals.

---

## W60-S05 — Structured planning proof and documentation closure

- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Prove the detailed planning path through public headless and web
  surfaces and align documentation with implemented behavior.
- **Primary modules:** `README.md`, `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`,
  `scripts/live-e2e/**`, root checks
- **Hard dependencies:** W60-S04
- **Primary user story surfaces:** EMP-02, EMP-03, OPS-06, OPS-10, FIN-03.

### Local tasks

1. **Build compatibility and medium+ proof scenarios.**
   - Purpose: prove current small plans remain valid while detailed plans close
     the identified completeness gap.
   - Changes: add one small compatibility fixture and one medium+ mission with
     task dependencies, criteria mapping, and verification evidence.
   - Validation: both use public AOR commands and current contract loaders.
2. **Exercise revision, approval, execution mapping, and retry.**
   - Purpose: prove task identity and approval semantics across real state
     transitions.
   - Changes: capture plan v1 rejection, v2 approval, execution-unit mapping,
     failed attempt, retry, and evidence-derived task completion.
   - Validation: no new task ID is created solely because an attempt retries.
3. **Run browser-task UX assessment.**
   - Purpose: verify the Plan workbench is understandable and accessible to an
     installed user.
   - Changes: capture task success, DOM/accessibility evidence, responsive
     evidence, screenshots, UX findings, and recovery behavior.
   - Validation: quality assessment has non-empty inspected evidence refs.
4. **Refresh source-of-truth and operator docs.**
   - Purpose: describe shipped task depth and current limitations accurately.
   - Changes: update README, operating model, contracts, command/API catalog,
     UX docs, and runbooks after implementation.
   - Validation: docs do not claim parallel or multirepo execution before W62.
5. **Close findings and run gates.**
   - Purpose: prevent documentation-only or mock-only closure.
   - Changes: requalify the `392f94c` provisional baseline against the final
     W57-W59 contracts/ratchets, classify residual findings by owner/phase,
     reconcile implemented-versus-accepted story/docs claims, create follow-up
     slices when needed, run root/slice gates, and verify runtime artifacts stay
     uncommitted.
   - Validation: W60 closes only with passing or explicitly non-pass live proof
     collected after its hard dependencies, never from the pre-dependency commit.

### Acceptance criteria

1. Public proof covers structured planning, revision, approval, task-to-unit
   mapping, retry under one task ID, and evidence-derived completion.
2. Browser proof covers task comprehension, keyboard use, responsive layout,
   failure recovery, and project/flow isolation.
3. Existing compact task packets remain compatible.
4. Documentation matches implementation and does not overclaim W61/W62 behavior.
5. Root checks and `pnpm slice:gate` pass with no committed runtime state.
6. Every provisional W60 artifact has a post-W59 compatibility/quality
   disposition and no source claims landed code as accepted solely because it exists.

### Done evidence

- small and medium+ proof artifacts
- browser-task and quality-assessment refs
- updated source-of-truth and runbooks
- passing root and slice gates

### Out of scope

- Project topology onboarding.
- Parallel or coordinated multirepo execution.
- Publishing a release.
