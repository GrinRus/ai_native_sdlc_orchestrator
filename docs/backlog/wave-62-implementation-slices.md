# W62 - repo-aware execution and coordinated delivery

W62 turns approved detailed tasks and managed project topology into real
repo-aware execution. It provisions isolated workspace sets, derives an
execution DAG, runs independent units concurrently only when deterministic
checks allow it, integrates results, reuses bounded repair semantics, and
coordinates delivery across repositories.

## Wave objective

Delivery engineers and operators can execute one approved mission across a
monorepo or bounded multirepo project with explicit task/repository scope,
safe concurrency, integration gates, evidence-derived completion, and
recoverable coordinated delivery.

## Wave exit criteria

- Delivery-capable multirepo runs use a run-scoped workspace set with exact
  repository mounts, base refs, resolved commits, cleanup, and provenance.
- Impact analysis and the execution plan produce a validated DAG over tasks,
  repositories, components, scopes, and integration gates.
- Parent/child Runtime Harness execution supports bounded concurrency without
  overlapping paths, conflict keys, dependencies, or shared mutable workspaces.
- Failed child attempts preserve successful evidence, block integration, and
  retry/repair only the affected unit while invalidating stale downstream work.
- Integration, review, QA, locks, delivery plans, and delivery manifests close
  the original mission as one aggregate transaction.
- CLI/API/web and Live E2E evidence expose scheduler decisions, child attempts,
  integration state, partial delivery, and recovery without raw JSON dependence.

---

## W62-S01 — Workspace-set provisioner and repository change evidence

- **Epic:** EPIC-3 Routed execution; EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Provision one isolated execution root containing exact run-scoped
  checkouts for all participating repositories and collect per-repository change evidence.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core/**`,
  `packages/contracts/**`, workspace and Git tests
- **Hard dependencies:** W61-S03, W4-S01
- **Primary user story surfaces:** RMO-01, RMO-04, DEV-01, DTX-05, SEC-04.

### Local tasks

1. **Implement workspace-set resolution and validation.**
   - Purpose: resolve approved repository bindings into stable mount paths and
     exact base refs before any runner starts.
   - Changes: validate participating repo IDs, mounts, source paths/remotes,
     refs, dirty state, write mode, and project-scope conflicts.
   - Validation: unknown repo, duplicate mount, missing ref, dirty-policy block,
     and overlapping project scope fail before provisioning.
2. **Provision clone/worktree strategies per repository.**
   - Purpose: isolate delivery-capable execution from primary checkouts.
   - Changes: create run-scoped roots, select supported strategy per binding,
     record resolved commit/checkout metadata, and preserve no-write ephemeral
     compatibility.
   - Validation: single repo, monorepo, separate multirepo checkouts, and mixed
     strategy fixtures produce deterministic manifests.
3. **Add transactional cleanup and retention.**
   - Purpose: avoid orphaning or deleting useful failure evidence incorrectly.
   - Changes: apply per-run success/abort/failure cleanup, partial provisioning
     rollback, retained-failure inspection, and idempotent cleanup.
   - Validation: interrupted provisioning and cleanup retries leave accurate status.
4. **Collect per-repository Git and changed-path evidence.**
   - Purpose: stop assuming one Git root when classifying mission changes.
   - Changes: capture baseline/final status, changed paths, commits, untracked
     files, ignored runner scratch paths, and repository-local evidence refs.
   - Validation: nested independent `.git` roots and monorepo components classify correctly.
5. **Expose workspace-set provenance to Runtime Harness.**
   - Purpose: make execution, verification, review, and delivery inspect the
     same canonical checkouts.
   - Changes: pass workspace-set refs, execution root, repo map, base commits,
     and cleanup state through compiled context, step results, and reports.
   - Validation: no stage silently falls back to the operator primary checkout.

### Acceptance criteria

1. Workspace sets preserve exact repo IDs, mounts, refs, commits, and strategies.
2. Delivery-capable execution does not mutate primary checkouts.
3. Partial provisioning and cleanup are idempotent and evidence-backed.
4. Changed paths and Git state are collected separately for each repository.
5. Runtime Harness, review, and delivery share one canonical workspace-set ref.

### Done evidence

- workspace-set provisioner and manifest tests
- per-repository Git/change fixtures
- failure cleanup and idempotency tests
- Runtime Harness provenance examples

### Out of scope

- Task DAG scheduling.
- Parallel runner execution.
- Remote write-back.

---

## W62-S02 — Impact scope and execution DAG planning

- **Epic:** EPIC-2 Packet lifecycle; EPIC-3 Routed execution; EPIC-4 Quality platform
- **State:** done
- **Outcome:** Derive and validate the task/repository/component execution DAG,
  affected scope, integration checks, and concurrency candidates from approved evidence.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core/**`,
  `packages/contracts/**`, `examples/packets/**`, planner/scope tests
- **Hard dependencies:** W60-S03, W61-S03
- **Primary user story surfaces:** EMP-02, EMP-03, ARC-01, RMO-02, RMO-04, PSO-07.

### Local tasks

1. **Derive impacted repository/component scope.**
   - Purpose: translate mission and task paths into explicit impacted topology.
   - Changes: combine approved task scopes, component roots, repo/component
     graphs, contract/shared-package dependencies, and explicit operator overrides.
   - Validation: scope expansion beyond handoff requires a new plan revision and approval.
2. **Build the execution DAG.**
   - Purpose: preserve task dependencies while grouping only coupled work.
   - Changes: create execution units, task refs, dependency edges, grouping
     rationale, repository mounts, verification, and required integration gates.
   - Validation: cycles, unknown refs, dropped tasks, and dependency inversion fail.
3. **Classify concurrency candidates deterministically.**
   - Purpose: distinguish possible time savings from safe approved parallelism.
   - Changes: evaluate task dependencies, path overlap, component/shared-contract
     edges, conflict keys, workspace isolation, command locks, and policy limits.
   - Validation: each candidate has a reason; unsafe candidates are serialized
     with a stable blocker/classification.
4. **Define per-unit and integration verification.**
   - Purpose: ensure local unit success cannot substitute for aggregate compatibility.
   - Changes: assign repo/component commands, criterion/evidence mappings,
     integration validation refs, review/QA requirements, and stop conditions.
   - Validation: every top-level criterion is covered by unit or integration evidence.
5. **Materialize approval and diff evidence.**
   - Purpose: make scheduler-relevant changes auditable before execution.
   - Changes: persist DAG hash/version, compared plan refs, concurrency decision
     summary, uncovered risks, and approval state.
   - Validation: material DAG/scope changes invalidate previous approval.

### Acceptance criteria

1. Every approved task maps to exactly one execution unit or an explicit non-run task.
2. DAG dependencies and scope are valid subsets of approved handoff evidence.
3. Parallel candidates are deterministic, reasoned, and not yet assumed running.
4. Per-unit plus integration verification covers all required acceptance criteria.
5. Material DAG changes require a new approved execution-plan version.

### Done evidence

- execution-DAG contract/examples
- impacted-scope and dependency fixtures
- concurrency classification tests
- criteria/verification traceability report

### Out of scope

- Starting child runs.
- Integration patch application.
- Delivery manifests.

---

## W62-S03 — Parent/child Runtime Harness scheduler and bounded concurrency

- **Epic:** EPIC-3 Routed execution; EPIC-4 Quality platform; EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Execute approved units under one parent run with bounded child
  attempts and safe parallelism while preserving runner-agnostic Runtime Harness decisions.
- **Primary modules:** `packages/orchestrator-core/**`,
  `packages/observability/**`, `apps/cli/**`, `apps/api/**`, scheduler tests
- **Hard dependencies:** W62-S01, W62-S02, W24-S01
- **Primary user story surfaces:** EMP-03, EMP-04, EMP-05, DEV-01, DEV-05,
  OPS-01, OPS-07.

### Local tasks

1. **Add parent-run and child-unit control state.**
   - Purpose: make one mission the coordination boundary while each child uses
     normal Runtime Harness execution.
   - Changes: persist parent ID, unit/task refs, attempt number, dependency
     status, budget allocation, workspace refs, and aggregate transitions.
   - Validation: child state cannot escape parent project/flow/plan scope.
2. **Implement ready-queue and concurrency limits.**
   - Purpose: start only dependency-ready and conflict-free units within policy budgets.
   - Changes: add deterministic queue ordering, max concurrency, provider/tool
     capacity, cancellation propagation, and serialized-by-conflict decisions.
   - Validation: race, duplicate start, dependency block, budget exhaustion, and
     cancellation tests are deterministic.
3. **Execute child attempts through existing routed runtime.**
   - Purpose: reuse adapter, policy, permission, classification, retry, repair,
     verification, and evidence paths.
   - Changes: compile unit-scoped context and invoke normal run-level Runtime
     Harness without provider branches in scheduler core.
   - Validation: child pass/retry/repair/block/fail behavior matches standalone runs.
4. **Aggregate status and events safely.**
   - Purpose: expose parent progress without mixing child logs or declaring
     partial success as mission completion.
   - Changes: project query-safe child events, task progress, active lanes,
     blocker ownership, costs, and one next action into parent/read surfaces.
   - Validation: project/flow isolation, event ordering, reconnect, and pagination pass.
5. **Expose headless scheduler controls.**
   - Purpose: preserve CLI/API parity for start, inspect, pause, resume, cancel,
     retry failed unit, and hold parent flow.
   - Changes: extend run control with plan/unit refs and guarded actions.
   - Validation: invalid or conflicting control operations fail closed and audited.

### Acceptance criteria

1. Parent run owns mission closure; child attempts remain normal Runtime Harness runs.
2. Only ready, conflict-free, policy-allowed units run concurrently.
3. Duplicate starts, dependency races, and budget overruns fail deterministically.
4. Partial child success never marks the parent mission complete.
5. CLI/API expose the same scheduler state and controls as later web views.

### Done evidence

- parent/child state and scheduler tests
- concurrency, race, budget, cancel, and reconnect fixtures
- child compiled-context and Runtime Harness evidence
- CLI/API control examples

### Out of scope

- Integration patch application.
- Coordinated delivery.
- Provider-specific scheduling policy.

---

## W62-S04 — Integration, stale-task invalidation, and bounded repair

- **Epic:** EPIC-4 Quality platform; EPIC-5 Delivery and release; EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Integrate child outputs in dependency order, invalidate affected
  downstream work, and reuse bounded review/QA repair semantics before delivery.
- **Primary modules:** `packages/orchestrator-core/**`,
  `packages/observability/**`, `docs/contracts/**`, integration/repair tests
- **Hard dependencies:** W62-S03, W45-S02
- **Primary user story surfaces:** DEV-05, RQA-02, RQA-05, RMO-04, DTX-06, OPS-04.

### Local tasks

1. **Materialize an integration workspace and apply outputs.**
   - Purpose: combine child work without mutating successful child evidence or
     primary checkouts.
   - Changes: apply patches/commits in dependency order, record source attempts,
     detect conflicts, and retain integration workspace on failure.
   - Validation: clean apply, overlapping patch, missing output, and partial
     application fixtures produce deterministic evidence.
2. **Run aggregate verification, review, and QA.**
   - Purpose: prove cross-component/repository compatibility and original
     mission acceptance after unit-level pass.
   - Changes: execute integration refs/commands, criteria traceability, review,
     QA, and Runtime Harness mission semantics against the integrated tree.
   - Validation: unit pass plus integration fail remains non-deliverable.
3. **Invalidate stale downstream tasks precisely.**
   - Purpose: rerun only work whose assumptions, inputs, contracts, or paths
     changed materially.
   - Changes: compare dependency evidence and changed scopes, mark tasks stale,
     preserve previous attempts as historical, and compute the rerun boundary.
   - Validation: unrelated successful tasks remain accepted; dependent tasks do not.
4. **Reuse bounded quality repair requests.**
   - Purpose: avoid a second repair state machine for child/integration findings.
   - Changes: create/link W45 repair requests with source unit/integration gate,
     findings, scope, attempts, budgets, and next action.
   - Validation: exhausted repair blocks the parent and never loops automatically.
5. **Expose integration and recovery state headlessly.**
   - Purpose: make conflict, stale, repair, retry, and hold actions inspectable
     without web UI.
   - Changes: add aggregate reports, CLI/API reads/actions, blocker ownership,
     retained workspace refs, and recovery guidance.
   - Validation: invalid recovery actions, missing evidence, and wrong-project refs fail closed.

### Acceptance criteria

1. Child outputs integrate in explicit dependency order with source lineage.
2. Aggregate verification/review/QA gates the original mission, not only units.
3. Stale invalidation reruns affected dependencies without discarding unrelated pass evidence.
4. Repair uses W45 contracts/budgets and blocks on exhaustion.
5. Delivery remains blocked until integration and required quality gates pass.

### Done evidence

- integration apply/conflict tests
- stale-boundary and criteria traceability fixtures
- quality repair lineage and exhaustion tests
- CLI/API recovery examples

### Out of scope

- Remote delivery write-back.
- Automatic conflict resolution outside approved scope.
- Unbounded repair loops.

---

## W62-S05 — Coordinated delivery and execution UX

- **Epic:** EPIC-5 Delivery and release; EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Make parent/child execution, integration, and coordinated
  per-repository delivery understandable and recoverable in the local console.
- **Primary modules:** `apps/web/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/contracts/**`, `docs/product/**`, tests
- **Hard dependencies:** W62-S04, W20-S01, W24-S03
- **Primary user story surfaces:** EMP-03, RMO-03, RMO-04, RMO-05, RMO-06,
  DTX-04, DTX-08, OPS-01, OPS-10.

### Local tasks

1. **Implement the parent/child execution view.**
   - Purpose: show mission progress, dependencies, parallel lanes, attempts,
     repository scope, and blockers without implying all tasks run concurrently.
   - Changes: render parent summary plus unit rows/lanes with scheduler labels,
     reasons, heartbeat, verification, changed paths, and attempt history.
   - Validation: sequential, parallel-approved, serialized-by-conflict, failed,
     canceled, and disconnected states are readable and accessible.
2. **Implement integration and stale-work recovery UX.**
   - Purpose: let operators understand why integration blocked and what must rerun.
   - Changes: show applied outputs, conflicts, aggregate checks, stale tasks,
     repair budget, retained workspace, and retry/repair/hold actions through
     public control-plane mutations.
   - Validation: no UI action can bypass dependency, scope, quality, or approval gates.
3. **Extend coordinated delivery planning and manifests.**
   - Purpose: preserve one aggregate transaction with per-repository results.
   - Changes: require coordination/lock/integration evidence, task/unit lineage,
     repo changed paths, branch/commit/PR results, rollback refs, and partial status.
   - Validation: missing repo, lock, validation, integration, review, or Runtime
     Harness evidence blocks non-no-write delivery.
4. **Implement per-repository delivery and recovery UX.**
   - Purpose: make partial write effects impossible to misread as success.
   - Changes: render aggregate status plus repo rows, locks, write results,
     changed paths, refs, failed step, recovery/rollback action, and confirmation.
   - Validation: partial delivery remains visually and semantically failed until resolved.
5. **Verify accessibility, responsive behavior, and isolation.**
   - Purpose: keep dense operational views usable across screen sizes and projects.
   - Changes: accessible tables/list alternatives, focus management, text/icon
     status, narrow-screen row details, project/flow reset, and raw refs behind details.
   - Validation: keyboard, screen-reader, responsive, reconnect, and two-project tests pass.

### Acceptance criteria

1. Execution UI distinguishes parent run, tasks, units, attempts, and integration.
2. Scheduler decisions and serialization reasons are inspectable and accessible.
3. Integration/stale/repair recovery actions use public control-plane paths.
4. Delivery manifests and UI preserve per-repo plus aggregate transaction truth.
5. Partial delivery is never presented as success and has explicit recovery evidence.

### Done evidence

- execution/integration/delivery UI modules and browser tests
- coordinated delivery contract/runtime tests
- accessibility/responsive/project-isolation evidence
- partial delivery and recovery screenshots/DOM evidence

### Out of scope

- Portfolio transactions across independent project IDs.
- Automatic merge or rollback without policy/approval.
- Hosted collaboration.

---

## W62-S06 — Monorepo and bounded multirepo full-flow proof

- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Prove detailed planning, topology, safe concurrency, integration,
  repair, and coordinated delivery end to end on monorepo and bounded multirepo targets.
- **Primary modules:** `README.md`, `docs/product/**`, `docs/architecture/**`,
  `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`,
  `scripts/live-e2e/**`, root checks
- **Hard dependencies:** W62-S05, W60-S05, W61-S05
- **Primary user story surfaces:** EMP-03, DEV-05, RMO-04, RMO-05, RMO-06,
  DTX-06, DTX-08, OPS-06, OPS-10, FIN-03.

### Local tasks

1. **Define proof targets and mission matrix.**
   - Purpose: exercise both topology classes without unsafe arbitrary repositories.
   - Changes: select one monorepo mission with multiple components and one
     bounded multirepo mission with contract dependencies, bounded writes, and
     deterministic verification.
   - Validation: targets are disposable/curated, budgets are explicit, and
     upstream writes remain disabled unless a guarded proof mode is approved.
2. **Run detailed planning and topology proof.**
   - Purpose: verify tasks, criteria, bindings, components, repo graph, scope,
     and DAG before execution.
   - Changes: capture approved task/execution plan versions and workspace-set
     manifests for both targets.
   - Validation: no broad `**` or inferred dependency silently reaches execution.
3. **Exercise sequential, parallel, failure, and repair paths.**
   - Purpose: prove real scheduler behavior and bounded recovery rather than a
     happy-path-only demo.
   - Changes: run at least one parallel-approved pair, one serialized conflict,
     one failed child or integration gate, and one bounded retry/repair closure.
   - Validation: stable task IDs, attempt lineage, stale invalidation, and budgets remain correct.
4. **Exercise integration and coordinated delivery evidence.**
   - Purpose: prove monorepo one-repo delivery and multirepo aggregate/per-repo truth.
   - Changes: capture integration checks, review/QA, locks, delivery plan,
     manifests, changed paths, no-upstream-write assertions, and partial-failure recovery.
   - Validation: delivery cannot pass with missing or inconsistent child/integration evidence.
5. **Run browser-task and final quality assessment.**
   - Purpose: validate the complete operator journey and dense UX under real evidence.
   - Changes: capture task outcome, DOM/accessibility, screenshots, responsive
     states, recovery actions, inspected evidence refs, and UX findings.
   - Validation: all required dimensions pass or produce explicit non-acceptance.
6. **Refresh docs, findings, and backlog truth.**
   - Purpose: close the program only when implementation, docs, proof, and
     current claims agree.
   - Changes: update README, product/architecture/contracts/runbooks/examples,
     coverage matrix, findings, and follow-up backlog; run root/slice gates.
   - Validation: no runtime/local-binding state is committed and no blocked/warn
     proof is counted as product acceptance.

### Acceptance criteria

1. One monorepo and one bounded multirepo mission complete the public flow or
   record precise non-acceptance blockers.
2. Proof includes real task/DAG/workspace/child/integration/delivery lineage.
3. Safe concurrency and serialized conflicts are both demonstrated.
4. Failed child/integration behavior proves bounded retry/repair and stale invalidation.
5. Browser UX and final quality assessments carry non-empty inspected evidence.
6. Documentation, coverage status, and backlog state match the final proof truth.

### Done evidence

- monorepo and bounded multirepo run/proof refs
- scheduler, repair, integration, and coordinated delivery evidence
- browser-task and final quality assessment reports
- updated docs/findings/coverage and passing root/slice gates

### Out of scope

- Organization-wide portfolio orchestration.
- Unbounded concurrency or repair.
- Default upstream writes or release publication.
