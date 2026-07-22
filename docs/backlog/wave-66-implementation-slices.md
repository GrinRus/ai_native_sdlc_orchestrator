# W66 - Live E2E qualification truth and runtime remediation

W66 is a learning-loop remediation wave created from the blocked installed-user
run `live-e2e-ky-medium-codex-20260717T170624Z` and the subsequent retained-run
and static code analysis. It restores the catalog-backed live E2E path, makes
qualification evidence truthful, preserves a strict product/private boundary,
and closes the runtime defects that would otherwise let a nominally successful
proof overstate parent-run, integration, delivery, or installed-console behavior.

## Wave objective

Catalog repository locators remain portable source metadata while generated AOR
project profiles use canonical repository identities. Public runtime behavior is
validated independently of the private proof harness. Qualification joins
terminal lifecycle, run health, deterministic diagnostics, final outcome
quality, exact changed paths, and no-upstream-write evidence. Fresh medium and
large Codex and Claude cells run only after deterministic runtime, delivery, and
installed-console gates are trustworthy.

## Entry conditions

- W65-S07 is done and the repository gate is green.
- Retained W66 evidence identifies catalog/bootstrap, qualification-truth,
  controller, runtime atomicity, integration, delivery, and browser-proof gaps.
- Product runtime and private live E2E remain separate: public operations cross
  the boundary only through the installed CLI and versioned public JSON.
- Codex and Claude host authentication may be used only by the terminal live
  qualification slice; upstream writes remain disabled throughout the wave.

## Wave exit criteria

- Catalog locators and generated canonical repository identities remain
  distinct, deterministic, and collision-checked.
- Product modules import no private live-E2E logic and know no private filenames
  or workspace topology; private validation cannot drift from public contracts.
- A qualification cell cannot pass without terminal public lifecycle, passing
  run health and diagnostics, a validated final all-pass assessment, exact
  changed-path evidence, and no-upstream-write proof.
- Medium and larger plans fail closed when mission-specific structured output is
  missing; provider transport success cannot hide partial semantic completion.
- Jobs, attempts, run control, events, parent/child scheduling, integration, and
  coordinated delivery are atomic, replay-safe, and evidence-backed.
- Installed browser proof exercises durable action outcomes across responsive,
  keyboard, accessibility, reload, reconnect, partial, and offline scenarios.
- All deterministic gates pass before any paid provider call.
- Four fresh Codex/Claude medium/large cells are recorded against one AOR commit
  and one pinned target commit, with no primary-checkout or upstream mutation.

## Delivery order

`W66-S01 -> W66-S02 -> W66-S03 -> W66-S04 -> W66-S05 -> W66-S06 -> W66-S07 -> W66-S08 -> W66-S09`

## W66-S01 — Catalog identity and bootstrap remediation baseline

- **Epic:** EPIC-0, EPIC-1, EPIC-7
- **State:** active
- **Outcome:** The original W66 catalog, bootstrap, public repair, disposable
  workspace, intake, delivery-identity, and learning-lineage remediations are
  covered by deterministic regression evidence without claiming live
  qualification closure.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** `scripts/live-e2e/**`, public CLI contract surfaces,
  live E2E contract/tests, backlog/runbook evidence
- **Hard dependencies:** W65-S07
- **Primary user story surfaces:** DEV-01, OPS-06, SEC-04

### Local tasks

1. **Catalog and bootstrap baseline**
   - Purpose: Preserve portable catalog locators while satisfying canonical
     project-profile identity rules and honest bootstrap attribution.
   - Changes: Keep generated repository IDs deterministic, retain source
     locators separately, reject collisions, and classify failed public init
     before controller-incomplete fallback.
   - Validation: Current `ky`, organization/repository, collision, bootstrap
     failure, pending-decision, provider-failure, and target-readiness fixtures
     produce the expected identities and owner/phase/class values.
2. **Public lifecycle lineage baseline**
   - Purpose: Keep plan, repair, run-status, review, learning, and follow-up
     operations inside the explicitly selected public project.
   - Changes: Preserve the generated profile and canonical runtime run identity
     through installed CLI arguments and public evidence refs; use no private
     runtime imports.
   - Validation: Focused fixtures prove exact project/run ownership and reject
     adjacent-runtime or qualification-ID leakage at public ingress.
3. **Disposable execution and evidence baseline**
   - Purpose: Permit bounded patch-only edits in a disposable workspace without
     granting primary-checkout or upstream writeback.
   - Changes: Keep provider-visible local inputs inside the disposable root,
     preserve canonical evidence refs separately, and resolve review Git state
     from immutable routed-step lineage.
   - Validation: Meaningful edits occur only in the disposable workspace;
     no-write remains read-only and evidence paths cannot select a checkout.
4. **Long-ID and content-addressed artifact baseline**
   - Purpose: Keep long qualification identities and content-addressed intake
     packets usable without weakening public ID validation.
   - Changes: Derive bounded delivery transaction IDs, preserve source run refs,
     and discover validated intake packets by packet type rather than filename.
   - Validation: Long W66 run IDs materialize delivery evidence and digest-named
     intake packets remain visible to Flow, next-action, analysis, and handoff.
5. **Backlog split and deterministic acceptance**
   - Purpose: Remove unrelated qualification, concurrency, delivery, and browser
     outcomes from the original oversized slice.
   - Changes: Register W66-S02 through W66-S09 in every backlog source of truth
     and retain live qualification only in W66-S09.
   - Validation: Backlog integrity, focused W66 regressions, and
     `pnpm slice:gate -- W66-S01` pass on a clean source checkout.

### Acceptance criteria

1. Generated `ky` profiles initialize without relaxing canonical ID validation.
2. External repository locators never become public repository identities.
3. Bootstrap command failure wins over controller-incomplete classification.
4. Public plan, repair, run, review, and learning lineage stays in one explicit project.
5. Patch-only execution edits only the disposable workspace and performs no upstream write.
6. Long run IDs and content-addressed intake packets remain discoverable and valid.
7. W66-S02 through W66-S09 are registered in dependency order.
8. Focused tests and the slice gate pass without provider calls.

### Done evidence

- Focused catalog, bootstrap, lifecycle-lineage, workspace, intake, and delivery-ID regressions.
- Backlog integrity and current tracked-test execution manifest.
- W66-S01 slice gate output.

### Out of scope

- Qualification verdict closure, concurrency repair, multirepo delivery proof,
  installed browser acceptance, and real provider calls; these belong to
  W66-S02 through W66-S09.

## W66-S02 — Private/product boundary and contract parity

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** blocked
- **Outcome:** Product runtime and the private live-E2E harness share only
  versioned public data and installed CLI subprocesses, with no executable-logic
  copy, reverse private vocabulary, or stale source-install reuse.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** `scripts/live-e2e/**`, `packages/contracts/**`, generic
  control-plane projections, boundary/parity tests
- **Hard dependencies:** W66-S01
- **Primary user story surfaces:** DEV-01, DEV-07, AIP-02, AIP-03, AIP-04, OPS-06, OPS-07

### Local tasks

1. **Executable boundary removal**
   - Purpose: Prevent private proof code from carrying a drifting copy of public
     contract validation behavior.
   - Changes: Replace the private executable validator fork with installed-CLI
     validation or a generated declarative snapshot containing no product logic.
   - Validation: Valid and mutated public examples produce identical public and
     private-boundary outcomes with zero diagnostic mismatches.
2. **Snapshot completeness**
   - Purpose: Make parity fail when public contract sources change.
   - Changes: Discover the complete public contract source set automatically and
     include kernel version, hashes, families, and generation metadata.
   - Validation: Added, removed, or changed source files fail parity until an
     intentional regeneration and version update occurs.
3. **Reverse-coupling removal**
   - Purpose: Keep product read models generic and independent of private proof
     filenames and directory layout.
   - Changes: Remove live-E2E filename and `target-checkouts` knowledge from
     product modules; adapt private summaries to a generic public projection only
     at an explicit ingress boundary.
   - Validation: Production vocabulary and dependency scans find no private
     report prefix, topology, or dynamic-token construction.
4. **Whole-tree boundary gate**
   - Purpose: Cover every runtime and entrypoint, not a curated subset.
   - Changes: Scan all tracked production, app, private-lib, and top-level runner
     modules; allow cross-reading only in test-only parity tooling.
   - Validation: Fixture imports in either direction fail the gate while current
     public CLI subprocess launch points remain allowed.
5. **Source-install cache identity**
   - Purpose: Prevent a dirty source tree from reusing an installation built from
     an older tree with the same HEAD.
   - Changes: Key cache reuse by the actual source-tree digest or fail closed on
     dirty input, without storing source contents or credentials.
   - Validation: Tracked and untracked source changes invalidate cached install proof.

### Acceptance criteria

1. No executable imports cross the product/private boundary in either direction.
2. No production module recognizes private live-E2E filenames or workspace layout.
3. Public/private boundary validation has zero behavior or diagnostic mismatches.
4. Every public contract source participates in snapshot parity.
5. Dirty source cannot reuse a stale isolated installation.
6. Package contents include no private runner modules or artifacts.

### Done evidence

- Whole-tree dependency and vocabulary scan output.
- Contract mutation-parity report and snapshot manifest.
- Dirty-source cache regression fixtures.

### Out of scope

- Qualification policy, provider execution, public runtime concurrency, and UI behavior.

## W66-S03 — Qualification verdict and evidence truth

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** blocked
- **Outcome:** A qualification cell passes only when terminal public lifecycle,
  run health, diagnostics, final outcome quality, exact changed paths, and
  no-upstream-write evidence all agree.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** `scripts/live-e2e/qualification-loop.mjs`, run-health and
  assessment contracts, evidence validators, deterministic qualification tests
- **Hard dependencies:** W66-S02
- **Primary user story surfaces:** RQA-03, RQA-04, OPS-06, OPS-07, FIN-03

### Local tasks

1. **Qualification cell contract**
   - Purpose: Make terminal acceptance explicit and machine-checkable.
   - Changes: Add a versioned cell report joining lifecycle, health, diagnostic,
     final-assessment, changed-path, checkout, and delivery evidence while keeping
     health and outcome quality as separate dimensions.
   - Validation: Exact pass, warn, blocked, missing, stale, wrong-run, and
     contradictory fixtures validate deterministically.
2. **Final assessment requirement**
   - Purpose: Prevent qualification from passing without expert outcome quality.
   - Changes: Require a validated final assessment and all-pass gate; missing or
     invalid assessment blocks the cell regardless of summary status.
   - Validation: Historical-style summaries without final assessments cannot pass.
3. **Step-quality truth**
   - Purpose: Replace reference-presence self-attestation with actual verdicts.
   - Changes: Materialize evaluator-authored dimensions and give deterministic
     verification conflicts precedence over semantic pass.
   - Validation: Partial verification, timeout, weak refs, and missing coverage
     produce explicit non-pass dimensions.
4. **Finding and failure taxonomy**
   - Purpose: Keep positive evidence separate from actionable gaps.
   - Changes: Split observations, positive evidence, warnings, and blocking
     findings; preserve provider, environment, operator, target, and AOR owners.
   - Validation: Classification fixtures produce one stable owner/phase/class and
     never project a positive observation as a gap.
5. **Explicit four-cell matrix**
   - Purpose: Assess the requested Codex/Claude cells without unrelated global counts.
   - Changes: Define exact medium/large cell identities and required evidence;
     preserve profile differences as qualification metadata rather than benchmark parity.
   - Validation: Matrix closure fails until all four required cells pass on one commit set.

### Acceptance criteria

1. Missing final assessment always blocks a cell.
2. Partial or timed-out verification cannot become qualification pass.
3. Run health, provider failure, environment failure, and outcome quality remain distinct.
4. Evidence kind, digest, ownership, freshness, and changed-path sufficiency are validated.
5. Positive observations are not counted as blocking findings.
6. Four-cell closure has no implicit OpenCode or unrelated provider requirement.

### Done evidence

- Qualification and step-quality contract fixtures.
- Historical-regression captures with corrected verdicts.
- Focused qualification and evidence-validation test output.

### Out of scope

- Real provider calls and runtime concurrency changes.

## W66-S04 — Planner, controller, and provider outcome semantics

- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-7
- **State:** blocked
- **Outcome:** Medium and large planning fails closed without mission-specific
  structure, provider semantic outcomes remain distinct from process exit, and
  the private controller preserves truthful retry, block, completion, and resume state.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** planner services, adapter outcome normalization,
  `scripts/live-e2e/lib/step-controller.mjs`, run-profile chronology, tests
- **Hard dependencies:** W66-S03
- **Primary user story surfaces:** EMP-01, EMP-02, DEV-01, DEV-05, RQA-05, OPS-06, OPS-07

### Local tasks

1. **Mission-specific planner gate**
   - Purpose: Prevent generic task fallback from satisfying medium-or-larger planning.
   - Changes: Restrict compact fallback to small missions; return typed blockers
     for missing structured candidates and run deterministic validation before evaluation.
   - Validation: Small, medium, large, missing, malformed, and multirepo candidates
     follow their expected branches with no medium+ generic trio.
2. **Provider outcome model**
   - Purpose: Separate transport completion from product completion.
   - Changes: Record process exit, adapter transport status, semantic provider
     outcome, and verification outcome independently; keep provider-specific
     parsing inside adapter boundaries.
   - Validation: Exit zero with partial verification remains non-pass, while a
     fully verified result preserves success.
3. **Provider progress parity**
   - Purpose: Preserve real progress for Codex JSON and other adapter-owned streams.
   - Changes: Normalize supported stream formats before redaction and retain
     heartbeat, last output, terminal outcome, model, and reasoning evidence.
   - Validation: Fake stream fixtures cover progress, permission, interaction,
     timeout, malformed output, and terminal result.
4. **Controller state separation**
   - Purpose: Distinguish observation from accepted completion.
   - Changes: Track observed, accepted, and completed steps separately; keep QA
     pending until its operator decision is accepted.
   - Validation: Pending, accepted, blocked, and completed fixtures expose exact states.
5. **Retry, block, and resume chronology**
   - Purpose: Keep operator intent and history stable across controller stops.
   - Changes: Retry the same step with a new iteration, preserve explicit block
     as terminal controlled outcome, and resume append-only history without
     replacing timestamps or command results.
   - Validation: Retry does not advance, block is not controller-incomplete, and
     resumed summaries retain the original chronology and refs.

### Acceptance criteria

1. Medium and large missions cannot materialize a generic fallback plan.
2. Structural plan failure prevents semantic evaluation.
3. Provider exit zero cannot hide partial semantic completion.
4. Pending QA is observed but not completed.
5. Retry remains on the same step and increments iteration.
6. Block and resume preserve accurate terminal state and chronology.

### Done evidence

- Planner and provider-outcome fixture matrix.
- Controller retry/block/resume regression captures.
- Adapter stream normalization tests.

### Out of scope

- Worker/job atomicity, parent scheduling, delivery, and real provider reruns.

## W66-S05 — Atomic jobs, attempts, run control, and live events

- **Epic:** EPIC-2, EPIC-3, EPIC-6, EPIC-7
- **State:** blocked
- **Outcome:** Run jobs, attempts, run-control commands, event journals, SSE
  replay, and browser live refresh remain single-owner, crash-recoverable, and
  idempotent under concurrency.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** run-job, attempt-store, run-control, observability event
  journal, HTTP SSE handlers, web control-plane client, concurrency tests
- **Hard dependencies:** W66-S04
- **Primary user story surfaces:** EMP-03, EMP-05, DEV-01, OPS-01, OPS-02, OPS-04, OPS-10, SEC-03

### Local tasks

1. **Atomic job ownership**
   - Purpose: Ensure one durable worker owns one run job.
   - Changes: Claim worker ownership under lock/CAS before spawn, record fencing
     metadata, and recover failed spawn without leaving a false running job.
   - Validation: Concurrent identical starts create one worker and deterministic replay/conflict results.
2. **Complete attempt identity and lease**
   - Purpose: Prevent stale result replay and legitimate long-attempt theft.
   - Changes: Digest all route, policy, evidence, mode, workspace, model, and
     capability inputs; reserve before side effects; renew leases with fencing.
   - Validation: Changed inputs conflict, dry-run cannot replay as live, and
     hour-bounded attempts retain one owner.
3. **Run-control CAS**
   - Purpose: Preserve concurrent pause, cancel, answer, and terminal updates.
   - Changes: Include the full command payload in idempotency identity and commit
     worker finalization under expected revision/CAS.
   - Validation: Concurrent commands are idempotent or typed conflicts and no accepted state is overwritten.
4. **Crash-recoverable event journal**
   - Purpose: Keep sequence, journal append, cursor, and request-key identity consistent.
   - Changes: Make sequence journal-owned, introduce recoverable write ordering,
     reconcile incomplete writes, and prevent duplicate request-key append.
   - Validation: Crash injection at every boundary produces no lost, duplicated, or skipped events.
5. **Bounded SSE and browser consumption**
   - Purpose: Deliver named events with durable reconnect and bounded memory.
   - Changes: Tail by cursor without full-file reads, honor replay backpressure,
     detect historical terminal events, and subscribe to `live-run-event` by name.
   - Validation: Slow-client, reconnect, late-follow, terminal-plus-evidence, and browser refresh fixtures pass.
6. **Waiting-input projection**
   - Purpose: Prevent exit-zero interaction requests from becoming succeeded jobs.
   - Changes: Project structured interaction state into durable job status before terminal classification.
   - Validation: Async interaction enters `waiting-input`, resumes once, and closes without duplicate work.

### Acceptance criteria

1. One logical run job has at most one active worker.
2. Attempt replay identity includes every execution-affecting input.
3. Long attempts renew fenced ownership.
4. Concurrent run-control updates are not overwritten.
5. Event append and request-key idempotency survive injected crashes.
6. SSE replay is bounded and the packaged web client receives named events.
7. Late follow terminates after an already recorded terminal transition.

### Done evidence

- Cross-process job, attempt, and run-control stress reports.
- Event crash-recovery and SSE backpressure/reconnect fixtures.
- Browser live-refresh regression proof.

### Out of scope

- Distributed scheduling, hosted transport, and provider-network execution.

## W66-S06 — Parent/child integration and coordinated delivery correctness

- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7
- **State:** blocked
- **Outcome:** Parent/child scheduling, workspace provisioning, integration, and
  coordinated multirepo delivery execute real repository-specific work and
  retain truthful partial/recovery evidence.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** parent-run scheduler, workspace-set provisioner,
  integration service, delivery driver/modes, run projections, tests
- **Hard dependencies:** W66-S05
- **Primary user story surfaces:** EMP-03, DEV-05, RMO-04, RMO-05, RMO-06, DTX-06, DTX-08, OPS-01, OPS-04, OPS-10

### Local tasks

1. **Parent event and launch transaction**
   - Purpose: Prevent a parent command from failing after children have started.
   - Changes: Version parent event types, couple unit reservation and child
     launch, and roll back reservation/budget on failed spawn.
   - Validation: Start, retry, pause, resume, cancel, and failed-launch fixtures
     leave one coherent parent revision and event trail.
2. **Child completion and cancellation**
   - Purpose: Let parent scheduling progress and terminate from real child state.
   - Changes: Call parent completion under CAS from child terminal processing,
     reschedule dependency-ready units, and complete bounded cancel cleanup.
   - Validation: Dependencies advance after child completion and cancellation reaches terminal `canceled`.
3. **Mandatory workspace-set execution**
   - Purpose: Bind every child to approved repository mounts and base commits.
   - Changes: Make provisioner output mandatory, pass repository maps and
     execution roots to children, and forbid launcher/primary-checkout fallback.
   - Validation: Single-repo, monorepo, and multirepo children execute only in their provisioned roots.
4. **Authoritative integration materialization**
   - Purpose: Prevent client-provided report status from promoting a parent.
   - Changes: Have the application service materialize and verify integration
     from immutable outputs, digests, ownership, scope, and DAG order.
   - Validation: Forged, stale, wrong-unit, out-of-scope, conflicting, and partial reports fail closed with recovery evidence.
5. **Per-repository delivery stages**
   - Purpose: Replace one-root execution projected as multirepo success.
   - Changes: Execute and record locks, exact paths, base/head, commit, branch,
     PR, and rollback outcome separately for every repository.
   - Validation: Different repository outcomes remain distinct and aggregate success requires all mandatory stages.
6. **Partial-effect and transaction lineage**
   - Purpose: Preserve branch push or other completed effects when a later stage fails.
   - Changes: Retain partial outputs and make repeated delivery/release prepare
     idempotently reuse or explicitly supersede the transaction.
   - Validation: Injected post-push PR failure is reported as partial with exact recovery refs and no duplicate hidden transaction.

### Acceptance criteria

1. Parent commands cannot report failure after silently launching untracked children.
2. Child terminal state advances the parent scheduler and dependent queue.
3. Parent cancel reaches a terminal state after bounded cleanup.
4. Every child uses an approved run-owned workspace-set root.
5. Integration success is derived from verified outputs, not caller-provided status.
6. Multirepo delivery records and executes every repository independently.
7. Partial external effects and recovery evidence are never discarded.
8. Primary checkouts and upstream remotes remain unchanged in all fixtures.

### Done evidence

- Parent/child race, retry, cancel, and recovery matrix.
- Workspace provisioning and integration failure-injection reports.
- Single-repo, monorepo, and bounded-multirepo delivery goldens.

### Out of scope

- Automatic conflict resolution, unbounded repair, portfolio transactions, and real upstream writes.

## W66-S07 — Installed browser proof and design acceptance integrity

- **Epic:** EPIC-0, EPIC-1, EPIC-6, EPIC-7
- **State:** blocked
- **Outcome:** Installed Quiet Cockpit proof demonstrates authoritative lifecycle
  behavior, responsive accessibility, reload/reconnect recovery, and durable
  action outcomes rather than static loading or marker presence.
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** `scripts/live-e2e/**` browser collector, W63/W65 scenario
  fixtures, `apps/web/**` presentation fixes, installed-package tests
- **Hard dependencies:** W66-S06
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-04, OPS-06, OPS-07, OPS-11, OPS-12

### Local tasks

1. **Immutable proof identity**
   - Purpose: Prevent app smoke and lifecycle proof from overwriting or reusing ambiguous files.
   - Changes: Use separate content-addressed artifacts with kind, digest, run,
     scenario, ownership, and freshness metadata.
   - Validation: Wrong-kind, stale, overwritten, and cross-run refs fail proof validation.
2. **Authoritative scenario readiness**
   - Purpose: Avoid screenshots of transient loading state being treated as terminal evidence.
   - Changes: Wait for expected Project/Flow state and scenario-specific durable
     preconditions instead of a fixed delay.
   - Validation: Loading, timeout, partial, offline, and ready fixtures produce distinct outcomes.
3. **Action-to-readback proof**
   - Purpose: Validate real operator outcomes rather than DOM marker presence.
   - Changes: Record visible label, canonical structured mutation, response IDs,
     evidence refs, reload, and durable readback for each scenario action.
   - Validation: Label mismatch, unavailable action, duplicate artifact, and missing durable readback block the proof.
4. **Responsive and accessibility matrix**
   - Purpose: Complete installed design validation across supported operator contexts.
   - Changes: Add desktop, tablet, mobile, keyboard-only, dialog focus,
     200%-zoom/reflow, reduced-motion, semantic tree, contrast, and touch-target checks.
   - Validation: Viewport, focus restoration, accessible names/states, applicable
     WCAG AA contrast, overflow, and target-size assertions are executable.
5. **Recovery and live-state matrix**
   - Purpose: Prove that the console reconstructs truth after transport disruption.
   - Changes: Exercise reload, reconnect, partial/offline reads, injected error
     feedback, multi-item attention, project switching, and terminal read-only state.
   - Validation: No stale cross-project state, browser-owned completion, focus leakage, console error, or external request is allowed.

### Acceptance criteria

1. Smoke and lifecycle proof artifacts are immutable and independently validated.
2. Loading state cannot satisfy a terminal scenario.
3. Every safe action proves label, structured mutation, and durable readback.
4. Desktop, tablet, mobile, keyboard, zoom, and reduced-motion matrices pass.
5. Error feedback is tested through an injected error, not assumed absent.
6. Reload/reconnect and project switching preserve authoritative isolation.
7. The installed design has no unresolved P1 accessibility or product-safety finding.

### Done evidence

- Installed scenario report, accessibility summary, and deterministic finding ledger.
- Content-addressed browser evidence index without absolute paths or runtime state.
- Packaged SPA freshness and browser gate output.

### Out of scope

- Visual redesign, hosted UI, additional browser engines, credentials, and provider calls.

## W66-S08 — Deterministic remediation closure

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** blocked
- **Outcome:** Every retained-analysis finding owned by W66 has a reproducible
  deterministic disposition, all repository/package/browser gates pass, and the
  exact source commit is ready for paid live qualification.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** root quality/test/build/package gates, W66 finding ledger,
  deterministic fixture matrices, backlog/readiness docs
- **Hard dependencies:** W66-S07
- **Primary user story surfaces:** OPS-06, OPS-07, FIN-03

### Local tasks

1. **Finding-ledger reconciliation**
   - Purpose: Tie every active analysis result to an owner, fix, test, and residual limitation.
   - Changes: Record severity, reproduction, owning slice, commit, focused
     evidence, and disposition without committing raw runtime artifacts.
   - Validation: Every W66 finding has exactly one evidence-backed disposition and no unresolved P0/P1 item.
2. **Concurrency and recovery matrix**
   - Purpose: Re-run the high-risk deterministic runtime scenarios together.
   - Changes: Execute job, attempt, event, run-control, parent/child, integration,
     delivery, retained-workspace, and cleanup stress/failure-injection suites.
   - Validation: No lost state, duplicate work, false aggregate success, or primary-checkout mutation occurs.
3. **Repository and package gate**
   - Purpose: Prove the merged remediation is installable and regression-clean.
   - Changes: Run focused suites, quality ratchet, canonical check, browser gate,
     tracked-test manifest verification, package dry-run, and neutral-launcher install smoke.
   - Validation: Every tracked test runs exactly once and the installed package contains only intended public assets.
4. **Readiness hold and qualification manifest**
   - Purpose: Prepare one immutable commit/profile/target baseline without claiming live success.
   - Changes: Record AOR commit, profile digests, pinned target commit, expected
     cells, stop conditions, and no-upstream-write policy; keep W66
     qualification clearance open until S09 without overriding ledger-derived readiness.
   - Validation: The manifest is complete, secret-free, path-neutral, and rejects mismatched commits or profiles.

### Acceptance criteria

1. All W66 P0/P1 findings have resolved deterministic dispositions.
2. Runtime concurrency, crash, integration, delivery, and browser matrices pass.
3. `pnpm quality:ratchet`, `pnpm check`, and `pnpm test:web:browser` pass.
4. Every tracked test is discovered and executed exactly once.
5. Package dry-run/install smoke passes from a neutral launcher.
6. No live provider call is made and W66 qualification clearance remains open pending W66-S09.

### Done evidence

- W66 deterministic closure report and finding ledger.
- Current tracked-test execution manifest and package/browser summaries.
- Frozen qualification manifest for W66-S09.

### Out of scope

- Security scanning, real provider execution, upstream writes, and publication.

## W66-S09 — Fresh four-cell live qualification closure

- **Epic:** EPIC-0, EPIC-1, EPIC-4, EPIC-7
- **State:** blocked
- **Outcome:** One clean merged AOR commit completes the requested medium/large
  Codex and Claude matrix against one pinned target commit, with validated final
  quality and no primary-checkout or upstream mutation.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** private live-E2E profiles and operator loop, qualification
  reports, final assessment/evidence indexes, backlog/readiness closure docs
- **Hard dependencies:** W66-S08
- **Primary user story surfaces:** DEV-01, DEV-04, AIP-12, OPS-06, OPS-07, FIN-03

### Local tasks

1. **Installed guided proof baseline**
   - Purpose: Establish UI/UX and accessibility dimensions on the exact AOR commit used by all cells.
   - Changes: Run one installed guided proof with the S07 scenario contract and
     record its immutable evidence index without external network or source writes.
   - Validation: The proof passes action/readback, responsive, accessibility,
     reload/reconnect, and no-write criteria on the frozen commit.
2. **Sequential four-cell execution**
   - Purpose: Produce comparable provider qualification evidence without concurrent contamination.
   - Changes: Run medium Codex, medium Claude, large Codex, and large Claude in
     fresh isolated workspaces using one AOR commit and one pinned `ky` commit.
   - Validation: Every cell records actual provider/adapter/model/reasoning,
     terminal controller state, diagnostics, changed paths, delivery, and health.
3. **Public-only operation and bounded repair**
   - Purpose: Preserve the black-box boundary through every interaction and repair.
   - Changes: Use only installed public AOR commands for decisions, answers,
     repair, and closure; prohibit manual target fixes and upstream writes.
   - Validation: Command transcripts contain no private runtime calls, credentials,
     target-source escape, or external delivery effect.
4. **Final outcome assessment**
   - Purpose: Join runtime health with expert outcome quality without conflating them.
   - Changes: Prepare, validate, and gate a final assessment for each cell under
     all-pass policy using exact run-owned evidence.
   - Validation: Each cell passes the W66-S03 qualification contract and no missing or stale evidence is accepted.
5. **Failure and rerun discipline**
   - Purpose: Keep all four final results attributable to one source commit.
   - Changes: Give transient reruns new IDs with lineage; route product gaps to a
     separate fix slice and repeat the entire matrix after merge.
   - Validation: Final comparison includes only cells from the same accepted AOR/target commit pair.
6. **Wave closure**
   - Purpose: Publish an honest bounded qualification decision.
   - Changes: Commit only deterministic comparison, evidence indexes, finding
     dispositions, residual limitations, and readiness/backlog updates.
   - Validation: All four cells pass, the ledger-derived readiness verdict matches
     evidence, and `slice:complete`/`slice:sync-ready` close W66 consistently.

### Acceptance criteria

1. All four cells use one AOR commit and one pinned target commit.
2. Every cell reaches terminal public lifecycle with `run_health=pass`.
3. Required diagnostics, review, QA, and delivery evidence pass.
4. Every cell has a validated final all-pass quality assessment.
5. Exact changed paths are meaningful, scoped, and evidence-backed.
6. Primary AOR/target checkouts and upstream remotes remain unchanged.
7. No credential value, paid judge transcript, raw runtime path, or private artifact is committed.
8. Any product fix after matrix start invalidates and restarts all four final cells.
9. W66 closes only after the four-cell comparison and ledger-derived readiness decision are reproducible.

### Done evidence

- Four run summaries, observation reports, run-health reports, final quality assessments, and qualification cell reports.
- One same-commit comparison and path-neutral evidence index.
- W66 closure report, synchronized backlog, and readiness result.

### Out of scope

- New providers or target missions, hosted/distributed execution, credential
  storage, upstream delivery, npm/GitHub publication, and manual target fixes.
