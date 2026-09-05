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
- Every live adapter-backed step resolves one expected output schema before
  spawn, normalizes provider output at the adapter boundary, and executes all
  selected deterministic post-validators before Runtime Harness can pass.
- Output-format repair, evidence reconciliation, and write-capable work repair
  are distinct bounded actions; quality repair retries preserve request,
  workspace, finding, attempt, and budget lineage.
- Jobs, attempts, run control, events, parent/child scheduling, integration, and
  coordinated delivery are atomic, replay-safe, and evidence-backed.
- Installed browser proof exercises durable action outcomes across responsive,
  keyboard, accessibility, reload, reconnect, partial, and offline scenarios.
- All deterministic gates pass before any paid provider call.
- Four fresh Codex/Claude medium/large cells are recorded against one AOR commit
  and one pinned target commit, with no primary-checkout or upstream mutation.

## Delivery order

`W66-S01 -> W66-S02 -> W66-S03 -> W66-S04 -> W66-S05 -> W66-S06 -> W66-S07 -> W66-S08 -> W66-S10 -> W66-S11 -> W66-S12 -> W66-S13 -> W66-S14 -> W66-S15 -> W66-S16 -> W66-S17 -> W66-S18 -> W66-S19 -> W66-S20 -> W66-S21 -> W66-S22 -> W66-S23 -> W66-S24 -> W66-S25 -> W66-S09`

## W66-S01 — Catalog identity and bootstrap remediation baseline

- **Epic:** EPIC-0, EPIC-1, EPIC-7
- **State:** done
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
   - Changes: Register W66-S02 through W66-S09 in every backlog source of truth,
     retain live qualification only in W66-S09, and keep production readiness on
     an explicit audit hold until that qualification closes.
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
9. Production readiness returns a valid W66 `audit-hold` with
   `release_clearance=false`, and write-capable live execution is held by default.

### Done evidence

- Focused catalog, bootstrap, lifecycle-lineage, workspace, intake, and delivery-ID regressions.
- Backlog integrity and current tracked-test execution manifest.
- W66-S01 slice gate output.
- Production-readiness and runtime release-hold regressions.

### Out of scope

- Qualification verdict closure, concurrency repair, multirepo delivery proof,
  installed browser acceptance, and real provider calls; these belong to
  W66-S02 through W66-S09.

## W66-S02 — Private/product boundary and contract parity

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
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
- **State:** done
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
- **State:** done
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
- **State:** done
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
- **State:** done
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
- **State:** done
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
- **State:** done
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

## W66-S10 — Non-repair review warning approval compatibility

- **Epic:** EPIC-0, EPIC-4, EPIC-5
- **State:** done
- **Outcome:** Public review decisions permit an operator to approve a bounded
  review warning that recommends proceeding, while repair, human-review, failed
  finding, and failed Runtime Harness outcomes remain fail-closed.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** `docs/contracts/review-decision.md`,
  `packages/observability/**`, public review-decision CLI regressions, guided
  live-E2E compatibility tests
- **Hard dependencies:** W66-S08
- **Primary user story surfaces:** DEV-05, DTX-01, OPS-06

### Local tasks

1. **Approval compatibility contract**
   - Purpose: Align the public review-decision gate with the documented
     non-repair warning semantics already used by the live lifecycle.
   - Changes: Define delivery-compatible review evidence as `pass`, or `warn`
     plus `proceed` with no failed review finding; preserve the original review
     verdict in the decision basis.
   - Validation: Contract documentation and generated decisions agree without a
     schema or wire-format change.
2. **Fail-closed decision implementation**
   - Purpose: Permit bounded operator acknowledgement without weakening repair
     and Runtime Harness gates.
   - Changes: Evaluate review status, recommendation, failed findings, and
     Runtime Harness outcome together before materializing `approve`.
   - Validation: `repair`, `required-human-review`, failed findings, unknown
     states, and non-passing Runtime Harness outcomes remain blocked.
3. **Guided lifecycle regression and qualification restart**
   - Purpose: Close the exact delivery blocker discovered by the installed
     guided W66-S09 baseline.
   - Changes: Add focused positive and negative regressions, run repository
     gates, and invalidate the pre-fix qualification manifest and run evidence.
   - Validation: The public approve path accepts the retained non-repair warning
     shape, the slice gate passes, and W66-S09 restarts on the fix commit.

### Acceptance criteria

1. A `warn` review with `review_recommendation=proceed`, no failed finding, and
   a passing Runtime Harness may materialize an `approve` decision.
2. The decision basis retains `review_overall_status=warn`; no consumer
   misrepresents the review as `pass`.
3. Repair, required-human-review, failed finding, unknown, and failed Runtime
   Harness inputs cannot produce approval.
4. Public contracts and wire formats remain backward-compatible.
5. Focused tests, `pnpm check`, and `pnpm slice:gate -- W66-S10` pass without a
   provider call.
6. All pre-fix W66-S09 evidence is diagnostic only and qualification restarts
   from deterministic baseline on the new commit.

### Done evidence

- Review-decision contract clarification and focused positive/negative tests.
- Public lifecycle compatibility regression.
- W66-S10 slice gate and new qualification commit.

### Out of scope

- Weakening review findings, auto-approving warnings, target-source repair,
  provider/profile changes, large provider execution, or production clearance.

## W66-S11 — Bounded external-provider session convergence

- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Streaming external providers have a versioned, runner-agnostic
  post-spawn session budget that stops non-converging execution before provider
  context overflow while preserving truthful provider-owned failure evidence.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** adapter capability and step-result contracts,
  `packages/adapter-sdk/**`, Claude adapter profile, private live-E2E run-health
  contracts/tests
- **Hard dependencies:** W66-S10
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06

### Local tasks

1. **Versioned session-budget contract**
   - Purpose: Separate initial work-packet size from post-spawn provider
     convergence without changing adapters that omit the new policy.
   - Changes: Define the optional version-1 assistant-turn/tool-call budget,
     positive-bound validation, versioned external-runner report, and
     `provider_session_budget_exceeded` failure semantics.
   - Validation: Positive, negative, omitted-policy, and unknown-future-field
     fixtures prove backward compatibility and fail-closed validation.
2. **Runner-agnostic stream supervision**
   - Purpose: Stop a non-converging external process before its provider context
     window is exhausted.
   - Changes: Count sanitized assistant and tool events, persist warning status,
     terminate the complete process tree at a hard bound, and preserve bounded
     partial evidence without provider payloads.
   - Validation: Fake streams cover pass, warn, assistant/tool exhaustion,
     terminal-boundary completion, graceful and forced termination, timeout,
     cancellation, malformed JSONL, and secret redaction.
3. **Claude convergence profile**
   - Purpose: Give AOR observable Claude progress and a concrete convergence
     envelope without weakening model effort or host authentication.
   - Changes: Use verbose stream JSON, bounded built-in tools, disabled optional
     interactive integrations, numeric turn/tool guardrails, and one directed
     implementation pass while retaining `--effort high`.
   - Validation: Adapter profile tests prove host-auth compatibility, exact
     stream mode, bounded tool surface, session limits, and no `--bare`.
4. **Run-health and assessment fail-closed behavior**
   - Purpose: Keep early AOR supervision distinct from timeout, cancellation,
     compiled packet overflow, provider context overflow, and product quality.
   - Changes: Project the session report through step result and private
     run-health, classify hard exhaustion as provider-owned, and block final
     assessment for partial execution.
   - Validation: Focused controller, run-health, and quality-assessment
     regressions preserve owner/phase/class and compatibility.
5. **Deterministic closure and qualification reset**
   - Purpose: Land the behavior change before any new paid proof and restart W66
     qualification from a clean commit.
   - Changes: Run repository/package/browser/install gates, close W66-S11,
     invalidate earlier W66-S09 evidence, and freeze a new manifest only after
     the slice commit.
   - Validation: `pnpm slice:gate -- W66-S11` passes, W66-S09 becomes active
     again, and no live provider call occurs before the behavior commit.

### Acceptance criteria

1. Profiles without `session_budget` retain their existing behavior.
2. Configured streaming providers expose sanitized warning and terminal budget
   evidence with no prompt, tool payload, transcript, credential, or runner-home
   leakage.
3. Exceeding an assistant-turn or tool-call hard limit stops the entire process
   tree and returns `provider_session_budget_exceeded`.
4. Timeout, operator cancellation, compiled-context overflow, and
   provider-reported context overflow keep their existing distinct classes.
5. Claude uses verbose stream JSON, host auth, high effort, bounded built-in
   tools, and the declared 24/32/96 convergence envelope.
6. Focused tests, `pnpm quality:ratchet`, `pnpm check`, browser/package/install
   gates, and `pnpm slice:gate -- W66-S11` pass without a paid provider call.
7. All qualification evidence from before the W66-S11 behavior commit is
   diagnostic only.

### Done evidence

- Versioned adapter/step-result/run-health contract and validation fixtures.
- External supervisor and Claude profile regressions.
- Deterministic repository/package/browser/install gate results.
- W66-S11 slice gate and the new qualification behavior commit.

### Out of scope

- Changing provider authentication, lowering Claude effort, target-source
  repair, large provider execution, four-cell closure, or production clearance.

## W66-S12 — Resumable immutable browser-evidence reconciliation

- **Epic:** EPIC-0, EPIC-1, EPIC-7
- **State:** done
- **Outcome:** Re-entering a terminal guided flow reuses only a freshly
  revalidated content-addressed browser evidence index, so an already passing
  installed proof cannot be lost or silently trusted during resume.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** private guided browser collector, immutable browser proof
  validation, live-E2E resume regressions
- **Hard dependencies:** W66-S11
- **Primary user story surfaces:** PBO-09, OPS-06, OPS-07

### Local tasks

1. **Resume-safe collector reconciliation**
   - Purpose: Preserve immutable browser proof identity when the terminal
     controller rebuilds guided stage results.
   - Changes: Reload the prior collector record only when its request, proof,
     content-addressed index, and referenced objects can all be revalidated.
   - Validation: A terminal resume retains the exact index and passing proof
     without rerunning the browser collector.
2. **Fail-closed tamper handling**
   - Purpose: Prevent a stale collector status from authorizing changed evidence.
   - Changes: Recompute the index digest, require the digest-derived filename,
     and return `not_pass` when index or object validation fails.
   - Validation: Digest, filename, object, run, scenario, and freshness
     mismatches remain non-passing.
3. **Qualification reset**
   - Purpose: Keep the W66 matrix attributable to one behavior commit.
   - Changes: Close W66-S12 after deterministic gates, invalidate the attempted
     W66-S11 guided baseline, and freeze a new manifest before any provider call.
   - Validation: W66-S09 returns to active only after the S12 commit; installed
     baseline and both medium cells restart on that immutable commit.

### Acceptance criteria

1. Existing schema-version-2 browser proof is never accepted from a cached
   collector status alone.
2. Valid immutable evidence survives repeated terminal controller evaluation
   with the original content-addressed index.
3. Mutated or missing evidence fails closed and does not produce a guided
   journey proof.
4. Focused live-E2E tests, repository gates, and
   `pnpm slice:gate -- W66-S12` pass before qualification restarts.
5. The attempted guided run on `fec5e8d5` remains diagnostic only.

### Done evidence

- Resume and tamper regression tests.
- Deterministic gate results and W66-S12 slice gate.
- New qualification behavior commit and frozen manifest.

### Out of scope

- Provider policy changes, target repair, large provider execution, four-cell
  closure, or production clearance.

## W66-S13 — Stream auth telemetry classification

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Successful streaming provider initialization metadata cannot be
  misclassified as an authentication failure merely because it names the
  provider's API-key source field.
- **Delivery priority:** P0
- **Estimated effort:** XS
- **Primary modules:** adapter failure classifier, live-adapter preflight,
  streaming auth regression tests
- **Hard dependencies:** W66-S12
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06

### Local tasks

1. **Boundary-aware auth matching**
   - Purpose: Distinguish real API-key errors from successful stream telemetry.
   - Changes: Require a complete `api key`, `api_key`, or `api-key` token rather
     than matching arbitrary identifiers such as `apiKeySource`.
   - Validation: Successful Claude init/result JSONL passes preflight while
     explicit missing, invalid, and expired key errors remain `auth-failed`.
2. **Qualification reset**
   - Purpose: Keep the W66 qualification set attributable to one behavior commit.
   - Changes: Preserve the failed Anthropic preflight and every earlier S12 run
     as diagnostic evidence, close S13 through deterministic gates, then freeze
     and rerun the installed baseline and both medium cells.
   - Validation: No pre-S13 result can enter the final qualification matrix.

### Acceptance criteria

1. Stream metadata containing `apiKeySource` cannot create a false auth failure.
2. Real API-key error messages retain provider-owned `auth-failed`
   classification.
3. Adapter and live-E2E focused tests plus `pnpm slice:gate -- W66-S13` pass
   without a paid provider call.
4. W66-S09 returns to active only after the S13 behavior commit.

### Done evidence

- Boundary-aware failure-classification tests.
- Deterministic gate results and W66-S13 slice gate.
- New qualification behavior commit and frozen manifest.

### Out of scope

- Provider credentials, target repair, large provider execution, four-cell
  closure, or production clearance.

## W66-S14 — Repair closure warning approval parity

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Public repair closure applies the same reviewed warning
  eligibility as review approval, so a refreshed non-blocking warning cannot
  strand an otherwise passing repair lifecycle before delivery.
- **Delivery priority:** P0
- **Estimated effort:** XS
- **Primary modules:** review decision eligibility, public repair closure,
  observability and guided lifecycle regressions
- **Hard dependencies:** W66-S13
- **Primary user story surfaces:** DEV-05, DTX-01, OPS-06

### Local tasks

1. **Single warning-approval predicate**
   - Purpose: Remove semantic drift between review approval and repair closure.
   - Changes: Reuse one predicate for `pass` reviews and bounded `warn` reviews
     that recommend `proceed` and contain no failed finding.
   - Validation: Repair closure accepts the same warning report that an approve
     decision accepts, while repair/human-review/failed-finding outcomes remain
     blocked.
2. **Qualification reset**
   - Purpose: Keep the W66 matrix attributable to one behavior commit.
   - Changes: Preserve the failed S13 guided delivery as diagnostic evidence,
     close S14 through deterministic gates, then freeze and rerun the installed
     baseline and both medium cells.
   - Validation: No pre-S14 result enters the final qualification matrix.

### Acceptance criteria

1. Review approval and repair closure cannot disagree on bounded warning
   eligibility.
2. A warning with `repair`, `required-human-review`, or a failed finding remains
   blocked.
3. Focused observability/CLI/live-E2E tests and
   `pnpm slice:gate -- W66-S14` pass without a paid provider call.
4. W66-S09 returns to active only after the S14 behavior commit.

### Done evidence

- Shared warning-eligibility regression tests.
- Deterministic gate results and W66-S14 slice gate.
- New qualification behavior commit and frozen manifest.

### Out of scope

- Target repair policy, provider credentials, large provider execution,
  four-cell closure, or production clearance.

## W66-S15 — Structured stream failure-signal classification

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Successful structured provider streams cannot be misclassified
  from auth-like vocabulary in ordinary assistant output, while stderr and
  explicit structured failure events retain precise failure classification.
- **Delivery priority:** P0
- **Estimated effort:** XS
- **Primary modules:** adapter failure classification, live-adapter preflight,
  structured-stream regressions
- **Hard dependencies:** W66-S14
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06

### Local tasks

1. **Failure-relevant stream projection**
   - Purpose: Prevent normal provider output from becoming a false auth signal.
   - Changes: When stdout is a structured JSONL stream, classify only explicit
     error/failure events; continue to classify stderr and process errors.
   - Validation: Successful system, assistant, and result events may mention
     auth documentation without changing the successful preflight verdict.
2. **Compatibility and qualification reset**
   - Purpose: Preserve existing behavior outside structured provider streams
     and keep qualification attributable to one behavior commit.
   - Changes: Retain plain/buffered output classification and explicit
     structured error classification; invalidate all S14 qualification evidence
     and restart the installed baseline and medium cells after S15 closes.
   - Validation: Focused adapter and live-preflight regressions pass before any
     paid provider call, and no pre-S15 result enters the qualification matrix.

### Acceptance criteria

1. Auth-like text in a successful structured stream does not produce
   `auth-failed`.
2. Explicit structured failure events, stderr, timeout, cancel, and session
   budget failures retain their existing classifications.
3. Buffered JSON and plain-text adapters retain compatibility.
4. Focused adapter/live-E2E tests and `pnpm slice:gate -- W66-S15` pass without
   a paid provider call.
5. W66-S09 returns to active only after the S15 behavior commit.

### Done evidence

- Structured success/failure classification regressions.
- Deterministic gate results and W66-S15 slice gate.
- New qualification behavior commit and frozen manifest.

### Out of scope

- Provider prompt policy, target repair policy, large provider execution,
  four-cell closure, or production clearance.

## W66-S16 — Provider work-packet command-role separation

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Provider work packets distinguish commands the provider may run
  from the mission verification it must run, while controller-owned readiness
  and diagnostics cannot be promoted into provider repair obligations.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** provider work-packet contract and materialization,
  generated project profiles, handoff command policy, repair regressions
- **Hard dependencies:** W66-S15
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06

### Local tasks

1. **Versioned provider work-packet contract**
   - Purpose: Make provider command roles explicit and spawn-safe.
   - Changes: Emit work-packet v2 with separate `allowed_commands` and
     `required_commands`, require the required set to be a subset of the
     allowlist, retain v1 replay compatibility, and keep diagnostics
     controller-owned.
   - Validation: Invalid command-role packets fail before provider spawn as an
     AOR-owned construction error; v1 evidence remains readable.
2. **Generated command-role materialization**
   - Purpose: Prevent readiness setup from reappearing as mission lint or repair
     work.
   - Changes: Keep setup only in the generic readiness command group; expose
     ordered primary lint/build/test commands through repo and handoff surfaces;
     reuse completed preflight setup in repair workspaces.
   - Validation: Generated packets never list package installation as required
     verification and preserve primary command order and CI environment.
3. **Bounded repair guardrails**
   - Purpose: Converge repair without parallel setup, verification, or sandbox
     workarounds.
   - Changes: Instruct every adapter to perform one focused repair pass, execute
     only required commands sequentially, and return bounded environment-limited
     evidence after `EPERM` or `EACCES` instead of retrying or installing.
   - Validation: Codex, Claude, OpenCode, and Qwen receive equivalent semantics;
     timeout, cancel, session-budget, and context-overflow classifications remain
     unchanged.
4. **Deterministic closure and qualification reset**
   - Purpose: Establish a clean behavior commit before any paid provider call.
   - Changes: Run focused, repository, browser, package, and neutral-install
     gates; close S16; invalidate all qualification evidence on `b324a231`; then
     freeze a new manifest.
   - Validation: `pnpm slice:gate -- W66-S16` passes, S16 is complete, and S09
     returns to active only on the new behavior commit.

### Acceptance criteria

1. Runtime-created provider work packets use version 2 and v1 packets remain
   replay-readable.
2. `required_commands` contains ordered mission-primary verification only and is
   a subset of `allowed_commands`; invalid packets block before spawn.
3. Readiness setup and diagnostics remain controller-owned and package install
   is absent from generated repo lint and repair-required commands.
4. Repair starts with failed focused verification, runs commands sequentially,
   and records sandbox denial without retry, install, or target workaround.
5. Provider adapters retain packet parity and Codex remains in
   `workspace-write` sandbox.
6. Focused tests, `pnpm quality:ratchet`, `pnpm check`, browser/package/install
   gates, and `pnpm slice:gate -- W66-S16` pass without a paid provider call.
7. The guided blocker `w66-s15-guided-b324a231-r3-20260729` remains diagnostic
   only, and every qualification result on `b324a231` is invalid for the new
   matrix.

### Done evidence

- Provider work-packet v2 contract and v1 replay compatibility tests.
- Generated profile, handoff, repair, sandbox-limitation, and adapter-parity
  regressions.
- Deterministic gate results, closed W66-S16 slice, and new frozen behavior
  manifest.

### Out of scope

- Provider timeout increases, session-budget changes, guided diagnostic timeout
  changes, large provider execution, four-cell closure, or production clearance.

## W66-S17 — Environment-qualified provider command identity

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Mission-primary verification commands resolve to their exact
  allowlisted environment-qualified form before provider work-packet subset
  validation, so real generated profiles can spawn without weakening the v2
  command boundary.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** provider work-packet command-role resolution, adapter
  contract tests, live-E2E generated command parity
- **Hard dependencies:** W66-S16
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06

### Local tasks

1. **Command identity contract clarification**
   - Purpose: Preserve exact v2 subset enforcement while allowing the
     controller to add reviewed environment assignments to mission commands.
   - Changes: Define command identity as the command after leading shell
     environment assignments only, and require emitted commands to use the
     exact matching allowlist entry.
   - Validation: `npx xo` resolves to `CI=1 npx xo`; arbitrary wrappers such as
     `echo npx xo` remain non-equivalent and block before spawn.
2. **Provider packet materialization repair**
   - Purpose: Align real generated Ky profiles with mission-primary command
     requirements.
   - Changes: Resolve primary and focused repair commands against the ordered
     policy allowlist before constructing `required_commands`; keep readiness,
     diagnostics, command order, and provider-neutral behavior unchanged.
   - Validation: The guided command set produces an exact
     `required_commands subset allowed_commands` packet with its `CI=1`
     environment preserved.
3. **Deterministic closure and qualification reset**
   - Purpose: Replace the failed frozen behavior commit before another paid
     provider attempt.
   - Changes: Record
     `w66-s16-guided-e8d8e270-r1-20260802` as diagnostic AOR-owned evidence,
     run focused/root/browser/package/install gates, close S17, and freeze a
     new manifest.
   - Validation: `pnpm slice:gate -- W66-S17` passes and W66-S09 returns to
     active only on the new behavior commit.

### Acceptance criteria

1. Environment-qualified allowlist entries satisfy equivalent mission-primary
   commands without changing the work-packet v2 schema.
2. `required_commands` contains only exact strings present in
   `allowed_commands`, in mission order, with controller-provided environment
   assignments preserved.
3. Non-environment wrappers, setup commands, diagnostics, and unlisted commands
   cannot enter `required_commands`.
4. Codex, Claude, OpenCode, and Qwen retain identical packet semantics.
5. Focused tests and `pnpm slice:gate -- W66-S17` pass without another paid
   provider call.
6. Qualification evidence on `e8d8e270` is diagnostic only and the next guided
   baseline starts from a fresh frozen commit and workspace.

### Done evidence

- Environment-qualified command identity and negative wrapper regressions.
- Deterministic gate results, closed W66-S17 slice, and replacement frozen
  qualification manifest.

### Out of scope

- Provider/session/diagnostic timeout changes, sandbox relaxation, large
  provider execution, four-cell closure, or production clearance. If guided
  diagnostic timeout alignment is later required, it becomes W66-S18.

## W66-S18 — Guided diagnostic timeout alignment

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** The installed Ky guided qualification profile gives the complete
  non-blocking diagnostic suite a realistic aggregate allowance without
  weakening per-command bounds, cleanup, or product acceptance policy.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** private guided live-E2E profile, timeout resolver tests,
  live-E2E operator runbook
- **Hard dependencies:** W66-S17
- **Primary user story surfaces:** DEV-04, OPS-06, OPS-07

### Local tasks

1. **Diagnostic evidence disposition**
   - Purpose: Preserve the successful provider and primary evidence while
     preventing a timed-out diagnostic run from entering qualification.
   - Changes: Record `w66-s17-guided-b762eb46-r1-20260802` as diagnostic-only
     evidence with `run_health=warn`, owned by the target-repository diagnostic
     phase, and invalidate all qualification evidence on `b762eb46`.
   - Validation: Medium cells remain not run and W66-S09 stays blocked until a
     new behavior commit is frozen.
2. **Private aggregate timeout alignment**
   - Purpose: Allow the complete Ky suite, already observed to exceed 600
     seconds, to finish without changing provider execution policy.
   - Changes: Raise only
     `live_e2e.guided_warn_diagnostic_timeout_sec` from 600 to 1800 for the
     installed guided profile; keep the per-command timeout, warning failure
     mode, process-group cleanup, and default policy unchanged.
   - Validation: A synthetic duration above 600 seconds is within the profile
     allowance, while a lower target-command bound still caps the aggregate
     timeout.
3. **Deterministic closure and qualification reset**
   - Purpose: Establish a clean behavior commit before another provider call.
   - Changes: Run focused timeout/profile tests, root/browser/package/install
     gates, close S18, sync readiness, and freeze a replacement manifest.
   - Validation: `pnpm slice:gate -- W66-S18` passes without a paid provider
     call and W66-S09 returns to active only after the new commit is frozen.

### Acceptance criteria

1. The installed guided Ky profile uses an 1800-second aggregate warning
   diagnostic timeout while the repository default remains 120 seconds.
2. Per-command timeout capping, hard-timeout classification, and descendant
   process cleanup remain intact.
3. A complete diagnostic suite taking more than 600 seconds can finish within
   the explicit profile allowance.
4. The previous guided run remains diagnostic only and no medium or large
   provider cell runs before S18 closes.
5. Focused tests and all deterministic slice gates pass.

### Done evidence

- Profile-specific timeout-resolution regression and existing hard-timeout,
  run-health, and process-group cleanup regressions.
- Deterministic gate results, closed W66-S18 slice, and replacement frozen
  qualification manifest.

### Out of scope

- Provider/session-budget changes, sandbox relaxation, product API or wire
  changes, large provider execution, four-cell closure, or production
  clearance.

## W66-S19 — Provider verification-scope convergence

- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** External providers keep test changes inside the surface exercised
  by mission-primary commands, while the private controller preserves public
  review approval semantics and attributes verification-mapping blockers before
  delivery.
- **Delivery priority:** P0
- **Estimated effort:** S
- **Primary modules:** provider work-packet instructions, Ky small-canary
  contract, private review gate and run-health classification, adapter/live-E2E
  regressions
- **Hard dependencies:** W66-S18
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06, OPS-07

### Local tasks

1. **Diagnostic evidence disposition**
   - Purpose: Preserve the completed provider execution without accepting an
     unverified broad target diff.
   - Changes: Record `w66-s18-guided-5bee6927-r1-20260802` as diagnostic-only;
     its provider, primary verification, Runtime Harness, and QA passed, but
     delivery correctly blocked because four changed test files were outside
     the mission-primary AVA command.
   - Validation: No browser, medium, or large result from `5bee6927` counts
     toward qualification and W66-S09 remains blocked during S19.
2. **Verification-scope provider guardrail**
   - Purpose: Prevent a provider from creating review-blocking test evidence it
     is contractually forbidden to execute.
   - Changes: Strengthen the runner-agnostic provider work-packet and all
     adapter launcher instructions: every changed test file must be exercised
     by `required_commands`; otherwise the provider must avoid that edit or
     return a bounded scope-mismatch report. Clarify the Ky header canary to
     keep test changes in `test/headers.ts`.
   - Validation: Codex, Claude, OpenCode, and Qwen share the same instruction;
     setup and diagnostics remain controller-owned and packet v2 stays
     backward-compatible.
3. **Review-owner fidelity**
   - Purpose: Stop before an impossible public approve call and retain the
     actual provider-quality owner.
   - Changes: Align private delivery eligibility with the public review gate:
     `warn` is delivery-compatible only with `review_recommendation=proceed`
     and no failed finding. Map a primary-pass verification warning with
     `required-human-review` to provider-owned `verification_mapping_gap`.
   - Validation: The controller never calls public approve for human-review
     evidence; genuine bounded `warn+proceed` remains compatible.
4. **Deterministic closure and qualification reset**
   - Purpose: Establish a new immutable behavior commit before another paid
     run.
   - Changes: Run focused adapter/catalog/controller tests, root/browser/
     package/install gates, close S19, sync readiness, and freeze a replacement
     W66 manifest.
   - Validation: `pnpm slice:gate -- W66-S19` passes without provider calls and
     W66-S09 returns to active only after the new commit is frozen.

### Acceptance criteria

1. Provider-facing instructions forbid changed test files not exercised by
   ordered mission-primary `required_commands`.
2. The Ky small header canary explicitly limits test edits to
   `test/headers.ts`; source changes remain governed by lint and build.
3. `warn+required-human-review` cannot reach public approve and preserves
   provider/review/`verification_mapping_gap` classification.
4. `warn+proceed`, no failed finding, and passing Runtime Harness retain the
   W66-S10 approval compatibility.
5. Packet version, session budget, timeout, sandbox, public review contract,
   and large profiles are unchanged.
6. Focused and deterministic slice gates pass before another paid provider
   call.

### Done evidence

- Adapter parity and verification-scope instruction regressions.
- Review eligibility and owner-classification regressions for proceed,
  human-review, repair, and failed findings.
- Deterministic gate results, closed W66-S19 slice, and replacement frozen
  qualification manifest.

### Out of scope

- Auto-approving human-review evidence, dynamically executing provider-chosen
  commands, target-source repair, provider timeout changes, large provider
  execution, four-cell closure, or production clearance.

## W66-S20 — Runner output contract and failure taxonomy

- **Epic:** EPIC-0, EPIC-2, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Every adapter-backed step declares one expected structured-output
  family before provider spawn, and public contracts distinguish process,
  transport, provider, parsing, validation, verification, and mission outcomes.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** output/step/adapter/policy contracts, provider work-packet
  contract, contract registry, examples, public/private kernel parity
- **Hard dependencies:** W66-S19
- **Primary user story surfaces:** DEV-01, DEV-05, AIP-12, RQA-05, OPS-06, OPS-07

### Accepted pre-implementation decisions

ADR 0022 is the normative decision baseline for this slice and its W66-S21
through W66-S25 consumers. In particular:

- every newly emitted live or write-capable adapter-backed step is strict and
  resolves one exact `<family>@v<integer>` candidate schema before spawn;
- a query-safe candidate is limited to 65,536 UTF-8 bytes, normalized issues
  are limited to 64 entries, and raw provider output remains evidence-only;
- only `parse_status=valid` may enter schema validation, while ambiguous output
  never selects a preferred object;
- process, transport, provider, parsing, candidate, validation, verification,
  and mission outcomes remain independently owned;
- required command IDs use AOR-owned environment-qualified command identity;
- v1/v2 provider work packets remain immutable replay evidence, while strict
  execution emits v3 and v1/v2 cannot satisfy the new qualification policy;
- structural validators run in the fixed order `output-schema`,
  `evidence-complete`, and `validation-commands` before semantic evaluation;
- schema qualification is bound to adapter digest, runtime selection, output
  mode, schema ref, and immutable evidence rather than the legacy
  `structured_output` boolean.

See `docs/architecture/adr/0022-runner-output-acceptance-boundary.md` for the
failure-action table, repair boundaries, compatibility policy, and ownership
matrix. W66-S20 materializes the accepted decisions in contracts and fixtures;
it does not reopen them inside adapter implementation.

### Local tasks

1. **Normalized runner-output envelope**
   - Purpose: Give every adapter one provider-neutral handoff into deterministic
     validation without asking core to understand native provider streams.
   - Changes: Define `runner-output-envelope@v1` with requested schema ref,
     parse status (`valid|missing|malformed|ambiguous|unsupported`), one bounded
     candidate payload, normalized issues, and raw evidence ref. Define which
     fields are query-safe and forbid prompts, credentials, tool arguments,
     transcripts, and local runner-home paths.
   - Validation: Contract fixtures cover each parse status, exactly-one-candidate
     semantics, bounded sizes, forbidden raw fields, and canonical evidence refs.
2. **Runner final-report candidate and AOR-owned report**
   - Purpose: Keep model-authored judgment separate from authoritative artifact
     identity and aggregation.
   - Changes: Define a minimal `runner-final-report@v1` candidate with
     `completed|partial|blocked`, summary, changed files, command-result claims,
     verification, risks, and optional repair closure. Require AOR to add public
     IDs, run/step identity, timestamps, verified evidence refs, and validation
     status when materializing the durable report.
   - Validation: Pass, partial, blocked, no-write, write-capable, and repair
     examples load; model-authored public IDs or authoritative aggregate status
     fail contract validation.
3. **Provider work-packet v3 output contract**
   - Purpose: Tell the runtime exactly which candidate schema and command IDs it
     must return instead of relying on `return_json=true` and prose instructions.
   - Changes: Define packet v3 `output_contract` with schema ref/version,
     exactly-one-candidate rule, required sections, status vocabulary, output
     size bound, and stable `required_command_id` references. Keep v1/v2
     immutable and readable as replay evidence but stop emitting them for new
     strict live execution.
   - Validation: Packet fixtures prove command IDs are unique and map one-to-one
     to required commands; legacy packets remain loadable but cannot satisfy the
     new strict qualification policy.
4. **Canonical failure taxonomy and policy mapping**
   - Purpose: Let retry, repair, fallback, escalation, and operator guidance act
     on stable runner-neutral classes.
   - Changes: Define detailed failure kinds for missing, malformed, ambiguous,
     unsupported, partial, missing-evidence, missing-verification, and
     verification-contradiction cases. Map them to policy-facing classes such as
     `schema-mismatch`, `missing-evidence`, `verification-missing`,
     `validation-commands-failed`, and `incomplete-result`.
   - Validation: A table-driven contract fixture proves every detailed kind has
     exactly one class and that unknown kinds fail closed rather than inheriting
     a broad repair default.
5. **Schema-aware adapter capability and migration policy**
   - Purpose: Stop treating one `structured_output: true` boolean as proof that
     every runner/model can satisfy every schema family.
   - Changes: Add supported schema refs and supported output modes to adapter
     capability profiles; document compatibility for legacy booleans and the
     later W68 model/effort qualification join. Strict routes require explicit
     schema support or durable qualification evidence before spawn.
   - Validation: Existing examples still load; strict route fixtures reject an
     adapter that only declares the legacy boolean or a different schema family.
6. **Contract examples and kernel parity**
   - Purpose: Keep public product contracts and the private live-E2E snapshot
     behaviorally identical before implementation depends on them.
   - Changes: Update the contracts index, examples, reference routing, contract
     families, live-E2E public-kernel snapshot, and validation notes together.
   - Validation: Contract loader, reference integrity, and public/private kernel
     parity pass without provider calls.

### Acceptance criteria

1. Every strict adapter-backed step can resolve one expected output schema
   before provider spawn.
2. Process, transport, provider, parsing, validation, verification, and mission
   outcomes have independent contract fields and vocabularies.
3. Empty, malformed, ambiguous, unsupported, partial, missing-evidence, and
   verification-contradiction outcomes have stable failure kinds and classes.
4. Models do not own public IDs, run identity, timestamps, verified evidence
   refs, or aggregate pass status.
5. New strict live execution emits provider work-packet v3; v1/v2 remain
   readable immutable replay evidence.
6. Schema-family support is explicit; `structured_output: true` alone cannot
   qualify a strict route.
7. Contract loader, examples, reference integrity, and kernel parity pass.
8. No runtime behavior or provider call is introduced in this contract slice.

### Done evidence

- Runner-output envelope and final-report contracts with pass/non-pass fixtures.
- Provider work-packet v3 and compatibility fixtures.
- Failure taxonomy and schema-capability validation matrix.
- Contract loader, reference, and public/private kernel parity output.

### Out of scope

- Adapter parsing implementation, post-validator execution, repair retry,
  provider qualification, live calls, or W66 closure.

## W66-S21 — Adapter output normalization and acceptance

- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** External-process adapters normalize native output into the shared
  envelope and reject empty, malformed, ambiguous, unsupported, or partial
  candidates even when the provider process exits zero.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** adapter SDK external-process parsing, provider stream
  extractors, adapter response evidence, capability preflight, focused tests
- **Hard dependencies:** W66-S20
- **Primary user story surfaces:** DEV-01, DEV-05, AIP-12, OPS-06, OPS-07

### Local tasks

1. **Separate extraction from acceptance**
   - Purpose: Prevent parsing convenience from silently deciding mission
     success.
   - Changes: Refactor external stdout handling into provider-format extraction,
     provider-neutral envelope construction, and deterministic acceptance.
     Return one envelope plus evidence/tool traces; never return raw prose as an
     accepted structured candidate.
   - Validation: Focused unit tests prove parsing alone cannot produce
     `adapter.status=success` before the requested schema accepts the candidate.
2. **Provider-owned terminal candidate extractors**
   - Purpose: Preserve runner-agnostic core while supporting real Codex,
     Claude, Qwen, OpenCode, and custom output modes.
   - Changes: Normalize supported native JSON, buffered JSON, stream JSON, and
     JSONL terminal events inside the adapter boundary. Require an explicit
     terminal report signal or exact candidate envelope rather than assuming
     the last stream event is the final report.
   - Validation: Provider-like fixtures map different native events to the same
     envelope without native event names leaking into core-visible fields.
3. **Fail-closed zero-exit acceptance**
   - Purpose: Close the current path where process success can hide invalid or
     absent final output.
   - Changes: Classify empty stdout, prose only, truncated JSON, malformed JSONL,
     missing terminal result, conflicting candidates, packet echo, unknown
     status/schema, and explicit partial as rejected adapter outcomes. Preserve
     existing permission, interaction, auth, timeout, cancellation, context,
     and session-budget classifications.
   - Validation: Every negative fixture exits through its exact failure kind;
     no negative case returns accepted success even with `exit_code=0`.
4. **Independent execution-outcome evidence**
   - Purpose: Retain truthful facts without conflating a rejected report with a
     failed process launch.
   - Changes: Preserve process exit, transport completion, provider outcome,
     parse status, output-validation status, and accepted-result status as
     independent evidence. Keep raw provider output only behind evidence refs.
   - Validation: Query-safe adapter and step-result fixtures expose all status
     dimensions but contain no prompt, credential, transcript, or runner-home
     content.
5. **Schema capability preflight**
   - Purpose: Block incompatible routes before they incur provider cost or touch
     a disposable target.
   - Changes: Resolve the wrapper/requested schema against adapter capability
     metadata before external spawn; report supported, unqualified, and
     unsupported states with stable blocker evidence.
   - Validation: Unsupported strict routes do not spawn; compatible legacy dry
     runs and explicitly soft profiles retain documented compatibility.
6. **Cross-adapter output matrix**
   - Purpose: Prevent fixes for one provider stream from drifting across other
     adapters.
   - Changes: Add one shared semantic fixture matrix projected through Codex,
     Claude, Qwen, OpenCode, and custom external-process encodings.
   - Validation: All adapters produce identical provider-neutral envelopes and
     failure classes for equivalent semantic outcomes.

### Acceptance criteria

1. `exit_code=0` plus empty, prose-only, malformed, ambiguous, unsupported, or
   partial output cannot return accepted adapter success.
2. Exactly one candidate satisfying the requested schema is required.
3. Provider-native parsing remains inside adapter modules.
4. Raw provider output is evidence-only and absent from query-safe projections.
5. Existing permission, interaction, timeout, auth, context, and session-budget
   behavior remains compatible.
6. Unsupported schema capability blocks before spawn.
7. The cross-adapter fixture matrix passes without live provider calls.

### Done evidence

- Adapter extraction/acceptance unit matrix.
- Query-safe process/transport/provider/parsing status fixtures.
- No-spawn capability-preflight regressions.
- Codex/Claude/Qwen/OpenCode/custom semantic parity results.

### Out of scope

- Core post-validator registry, controller repair policy, public repair retry,
  live provider qualification, or route model/effort selection.

## W66-S22 — Executable post-validation and output repair

- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Runtime Harness executes every selected deterministic
  post-validator before pass and separates no-write output repair, evidence
  reconciliation, and write-capable work repair under explicit budgets.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** validator registry, policy resolution, routed adapter
  invocation, step execution engine, Runtime Harness classify/verify evidence,
  failure policy, tests
- **Hard dependencies:** W66-S21
- **Primary user story surfaces:** DEV-01, DEV-05, RQA-05, OPS-06, OPS-07

### Local tasks

1. **Validator registry and pre-spawn policy validation**
   - Purpose: Turn policy validator names into executable behavior and prevent
     misspelled or unsupported validators from becoming silent no-ops.
   - Changes: Add a provider-neutral registry for `output-schema`,
     `evidence-complete`, and `validation-commands`; resolve the ordered list
     during policy preparation and block unknown IDs before provider spawn.
   - Validation: Known validators resolve in policy order; unknown, duplicate,
     or incompatible validator declarations produce deterministic blockers.
2. **Output-schema execution**
   - Purpose: Require the normalized candidate to satisfy the requested family
     before any step can pass.
   - Changes: Validate envelope parse status, schema ref/version, required and
     conditional fields, status vocabulary, size bounds, and forbidden raw
     fields. Materialize one deterministic `validation-report` entry with exact
     field findings and revision advice.
   - Validation: Pass, warn, fail, and blocked fixtures produce stable reports;
     structural failure prevents semantic evaluation and mission pass.
3. **Evidence and command validation**
   - Purpose: Stop model claims from substituting for run-owned facts.
   - Changes: Implement run/attempt ownership, stale/cross-run detection,
     required evidence coverage, diff/no-write proof, repair-finding coverage,
     and one-to-one `required_command_id` matching against controller-owned
     command results. Treat missing, invented, duplicated, failed, timed-out,
     or warning-failing command evidence according to policy.
   - Validation: Forged refs, stale refs, unknown commands, missing commands,
     and model-pass/controller-fail contradictions all fail closed.
4. **Acceptance-aware fallback and Runtime Harness classification**
   - Purpose: Let retry/fallback policy react to validation failure instead of
     stopping at transport success.
   - Changes: Feed validation outcome into route-attempt evidence and
     `classifyRuntimeStepOutcome`; stop fallback only on an accepted response;
     apply retry, repair, escalation, and block lists to canonical failure
     classes with no broad default.
   - Validation: Schema-qualified fallback runs only when policy permits; an
     unlisted failure class blocks without consuming another action budget.
5. **Truthful controller verify transition**
   - Purpose: Replace unconditional verify success with evidence-derived run
     truth.
   - Changes: Derive the controller `verify` transition from validation report,
     authoritative verification, mission semantics, unresolved findings, and
     repair state. Use `blocked` or `skipped` when verification is absent or
     intentionally inapplicable.
   - Validation: No controller report can claim verify pass without referenced
     passing validation/verification evidence.
6. **Bounded output and evidence repair**
   - Purpose: Correct weak-model formatting without repeating target edits.
   - Changes: Add `repair_kind=output-contract|evidence-reconciliation|work-product`.
     Output-contract repair receives raw evidence, expected schema, and
     findings under no-write permissions and a separate one-attempt budget.
     Evidence reconciliation derives facts from controller-owned evidence.
     Only work-product repair may write to the owned disposable workspace.
   - Validation: Format repair never changes the target; repeated malformed
     output exhausts its own budget and blocks; incomplete work enters normal
     review/repair policy instead of being hidden as formatting repair.

### Acceptance criteria

1. Every declared post-validator is resolved and executed in policy order.
2. Unknown validators block before provider spawn.
3. Validation fail or block makes `step_result.status=passed` impossible.
4. Model command/evidence claims never override controller-owned facts.
5. Route fallback stops only on an accepted result and remains policy-bounded.
6. Controller verify pass always cites actual passing evidence.
7. Output-contract and evidence repair cannot write to the target checkout.
8. Work-product repair retains existing disposable-workspace, review, and
   budget invariants.

### Done evidence

- Validator registry and ordered execution fixtures.
- Output/evidence/command validation reports for positive and adversarial cases.
- Acceptance-aware fallback and Runtime Harness decision regressions.
- No-write output-repair and evidence-reconciliation proof.

### Out of scope

- Public quality-repair retry, operator UI controls, model/effort cutover,
  paid provider calls, or four-cell qualification.

## W66-S23 — Explicit quality-repair retry and attempt lineage

- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-6, EPIC-7
- **State:** done
- **Outcome:** Operators can retry only the active quality repair through a
  public idempotent mutation that preserves request, cycle, finding, workspace,
  attempt, review, QA, and budget lineage without rerunning the whole flow.
- **Delivery priority:** P0
- **Estimated effort:** L
- **Primary modules:** quality-repair request/attempt contracts, observability
  service, CLI/API/OpenAPI mutation, lifecycle command, next-action and Flow
  projections, owned-workspace checks, tests
- **Hard dependencies:** W66-S22
- **Primary user story surfaces:** DEV-05, RQA-02, RQA-05, RQA-06, OPS-01, OPS-04, OPS-10

### Local tasks

1. **Quality-repair attempt contract**
   - Purpose: Preserve immutable identity for each execution without turning
     the mutable request projection into an unbounded history blob.
   - Changes: Define `quality-repair-attempt` with request/cycle refs, attempt
     index, parent attempt, trigger, repair run ID, status, owned workspace ref,
     input/finding fingerprints, route ref, failure class, timestamps, and
     evidence refs. Add active/latest attempt refs and revision to the request.
   - Validation: Contract fixtures cover reserved, running, completed, failed,
     blocked, canceled, and legacy request compatibility.
2. **Atomic attempt reservation and idempotency**
   - Purpose: Prevent duplicate retries and double budget consumption across
     CLI, API, reload, and concurrent operators.
   - Changes: Add a shared `retryQualityRepair` service with `command_id` and
     expected-revision CAS, one active-attempt lease, exclusive attempt index,
     atomic request/attempt write, and idempotent replay of a completed command.
   - Validation: Same command ID returns the same attempt; stale revision and
     concurrent distinct commands yield one winner and one readable conflict.
3. **Owned-workspace continuation**
   - Purpose: Retry the actual repair tree rather than a clean primary or
     unrelated checkout.
   - Changes: Resolve execution root from prior attempt/run lineage instead of
     accepting an arbitrary user path; verify project ownership, retained
     workspace identity, base/diff continuity, and input fingerprint before
     spawn. Block missing, primary, external, stale, or wrong-project roots.
   - Validation: Positive fixtures preserve accumulated changes; all workspace
     escape and substitution cases fail before provider execution.
4. **Budget debit and allowed state transitions**
   - Purpose: Keep retries bounded without charging deterministic pre-spawn
     failures or letting an operator bypass review/QA.
   - Changes: Reserve without debit, debit after launch acknowledgment, and
     retain the debit once provider execution begins. Allow retry only for a
     requested cycle with a terminal failed/blocked prior attempt and remaining
     budget. Reject active, review-required, QA-required, exhausted, and closed
     requests; require a distinct operator budget decision to extend an
     exhausted cycle.
   - Validation: State-table tests prove exactly-once debit, correct remaining
     attempts, no retry between repair and mandatory review, and no silent
     budget reset.
5. **Public CLI/API and next-action surface**
   - Purpose: Expose one truthful repair-only action without overloading parent
     scheduler `run retry`.
   - Changes: Add `aor repair retry` and the matching control-plane mutation
     with request ref, command ID, expected revision, and optional reason.
     Return attempt/run/job/status/next-action refs. Project Flow/Task reads show
     attempt N of M and offer Retry only when the server-owned state permits it.
   - Validation: CLI/API/OpenAPI parity, project scoping, readback, reload, and
     no-duplicate browser/control-plane fixtures pass.
6. **Repeated-failure convergence guard**
   - Purpose: Prevent a weak model from consuming every attempt on an identical
     repair with no new evidence.
   - Changes: Compare finding, workspace/diff, verification, validation,
     route/model, and evidence fingerprints. Block
     `repeated-repair-without-new-evidence` when policy threshold is reached;
     require new evidence, approved route change, budget decision, or operator
     hold before another attempt.
   - Validation: Same-fingerprint fixtures block deterministically while a
     materially changed finding/evidence context may consume the next approved
     attempt.

### Acceptance criteria

1. `repair retry` creates a new immutable attempt under the same request and
   cycle without rerunning intake, planning, or initial implementation.
2. One request has at most one active attempt.
3. Command ID and revision CAS make retry exactly-once across CLI/API/reload.
4. Attempt budget debits exactly once after launch acknowledgment and never
   resets implicitly.
5. Retry continues only the owner-marked disposable workspace.
6. Review-required, QA-required, exhausted, closed, and genuinely active states
   cannot retry.
7. Every completed write-capable retry returns through review and QA when
   required; delivery/release remain blocked until public repair closure.
8. Repeated identical failure without new evidence blocks instead of looping.

### Done evidence

- Quality-repair attempt contract and lifecycle fixtures.
- Atomic CAS/idempotency/concurrency test output.
- Owned-workspace continuation and escape-rejection matrix.
- CLI/API/OpenAPI/next-action parity evidence.
- Repeated-failure convergence regressions.

### Out of scope

- Resetting repair budgets, retrying closed requests, browser-owned lifecycle
  decisions, direct runner chat, arbitrary checkout selection, or upstream
  writes.

## W66-S24 — Structured artifact and evaluator hardening

- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Intent normalization, planning, semantic evaluation, and live
  quality assessment consume one normalized candidate mechanism and never infer
  pass from missing or malformed weak-model output.
- **Delivery priority:** P1
- **Estimated effort:** L
- **Primary modules:** intent service, planner decomposition, task-plan service,
  prompt/wrapper schema refs, live-E2E quality assessment projection, tests
- **Hard dependencies:** W66-S23
- **Primary user story surfaces:** EMP-01, EMP-02, DEV-01, DEV-05, RQA-05, OPS-06

### Local tasks

1. **Intent normalization extraction**
   - Purpose: Stop recursive greedy JSON discovery from selecting an accidental
     or conflicting object in weak-model prose.
   - Changes: Accept only the requested envelope or one explicitly delimited
     candidate; classify multiple objects as ambiguous and invalid JSON as
     malformed. Preserve field-level findings and one bounded no-write format
     repair. Do not create a confirmable preview from an invalid candidate.
   - Validation: Prose, fenced JSON, two objects, truncated JSON, unsupported
     work type, missing acceptance, invalid confidence, and size-limit fixtures
     follow exact prepared/needs-input/invalid branches.
2. **Planner candidate normalization**
   - Purpose: Keep medium+ mission-specific fail-closed semantics while removing
     dependence on arbitrary top-level or nested adapter output placement.
   - Changes: Read planner candidates only from the normalized envelope selected
     by the wrapper schema; preserve small-only compact fallback; emit exact
     structural findings and revision advice before semantic evaluation.
   - Validation: Small, medium, large, malformed, ambiguous, dependency-cycle,
     traceability, verification, evidence, and multirepo fixtures follow the
     documented branches with no generic medium+ plan.
3. **Semantic evaluator absence and contradiction**
   - Purpose: Remove the path where a successful routed eval with no evaluator
     payload becomes semantic pass.
   - Changes: Map missing evaluator output to `blocked/not_evaluated`, malformed
     output to fail, explicit findings/warnings to their validated statuses, and
     explicit valid pass only to pass. Skip evaluation entirely after structural
     plan failure and retain blocking-policy evidence separately.
   - Validation: Missing, malformed, warn, fail, blocked, and pass fixtures prove
     transport success alone cannot satisfy evaluation.
4. **AOR-owned live quality assessment projection**
   - Purpose: Reduce cross-field schema work for weak evaluators and prevent the
     evaluator from authoring its own authoritative qualification verdict.
   - Changes: Limit model-authored content to dimension judgments, findings,
     risks, decision, and repair recommendation. Derive IDs, refs, timestamps,
     missing dimensions, gap arrays, all-pass, status, and qualification-cell
     verdict deterministically from the accepted candidate and run evidence.
   - Validation: Missing dimension, contradictory decision, stale evidence,
     malformed judgment, and valid assessment fixtures yield deterministic
     reports and correction guidance.
5. **Shared correction and repair guidance**
   - Purpose: Give operators and automatic output repair actionable field-level
     instructions without raw JSON editing.
   - Changes: Standardize validation issue codes, field paths, summaries,
     retryability, suggested repair kind, and evidence refs across intent,
     planner, evaluator, and assessment families.
   - Validation: CLI/API/live-E2E consumers render the same bounded guidance and
     never expose raw provider transcripts or private paths.
6. **Focused cross-flow regression suite**
   - Purpose: Prove one normalization rule applies consistently across public
     artifact-producing flows.
   - Changes: Add shared fixtures plus intent, planner, eval, and live-assessment
     integration tests that cover accepted output, output repair, block, and
     exhaustion.
   - Validation: All focused suites pass and no family contains a local
     transport-success fallback to pass.

### Acceptance criteria

1. Intent, planner, semantic evaluation, and live assessment consume normalized
   schema-bound candidates rather than arbitrary adapter fields or prose.
2. Missing evaluator output never becomes pass.
3. Medium+ planning remains mission-specific and fail closed.
4. Invalid normalization cannot be confirmed into write-capable execution.
5. AOR owns public IDs, refs, timestamps, aggregate status, gaps, and
   qualification verdicts.
6. Every validation failure has query-safe field-level correction guidance and
   an explicit repair/block disposition.
7. Cross-flow regression suites pass without provider calls.

### Done evidence

- Intent extraction and validation fixture matrix.
- Planner structural-before-semantic regression output.
- Semantic evaluator missing/malformed/explicit-status matrix.
- Deterministic live-assessment projection and correction-guidance fixtures.

### Out of scope

- New product intent fields, broader planning features, judge-model promotion,
  model/effort selection UI, paid evaluations, or live qualification.

## W66-S25 — Weak-runner adversarial proof and qualification reset

- **Epic:** EPIC-0, EPIC-3, EPIC-4, EPIC-7
- **State:** done
- **Outcome:** Deterministic adversarial proof demonstrates that weak-runner
  output, evidence, verification, and repair failures cannot false-pass across
  supported schema families or adapter formats, then freezes the only commit
  eligible for a fresh W66-S09 matrix.
- **Delivery priority:** P0
- **Estimated effort:** M
- **Primary modules:** contract/adapter/core/observability focused tests,
  live-E2E fixtures and quality assessment, qualification manifest, backlog and
  readiness evidence
- **Hard dependencies:** W66-S24
- **Primary user story surfaces:** DEV-01, DEV-04, DEV-05, AIP-12, RQA-05, OPS-06, OPS-07

### Local tasks

1. **Adversarial output and evidence corpus**
   - Purpose: Encode the weak-model failure surface as replayable deterministic
     evidence rather than relying on one live provider transcript.
   - Changes: Add empty, prose-only, truncated, malformed JSONL, missing
     terminal, conflicting candidate, unknown schema/status, missing section,
     missing/invented command, missing/invented/stale/cross-run evidence,
     partial, model-pass/controller-fail, output-repair exhaustion, and
     repeated-repair fixtures.
   - Validation: Every fixture declares exact envelope status, failure kind,
     failure class, validator results, Runtime Harness decision, and next safe
     action.
2. **Schema-family coverage matrix**
   - Purpose: Prove hardening applies to every weak-model boundary in the flow.
   - Changes: Run the corpus against intent normalization, structured wave
     ticket, runner final report, repair closure, semantic evaluation, and live
     quality assessment families, with positive completed/blocked/no-write and
     repaired cases for each applicable family.
   - Validation: No negative family case passes; positive cases preserve exact
     contract and evidence lineage.
3. **Provider-format parity matrix**
   - Purpose: Detect encoding-specific regressions before live Codex/Claude
     qualification.
   - Changes: Project equivalent semantic outcomes through Codex-like stream
     JSON, Claude-like buffered JSON, Qwen-like JSONL, OpenCode, and custom raw
     external-process formats.
   - Validation: Equivalent outcomes produce identical provider-neutral
     envelopes, failure classes, validator results, and policy decisions.
4. **Repair and concurrency proof**
   - Purpose: Prove format repair and explicit quality retry remain bounded
     under duplicate, stale, concurrent, exhausted, interrupted, and repeated
     failure conditions.
   - Changes: Exercise no-write output repair, evidence reconciliation,
     write-capable retry, mandatory review/QA return, command replay, revision
     conflict, workspace loss, budget exhaustion, and convergence blocking.
   - Validation: Attempts and debits remain exactly-once; no repair path writes
     primary/upstream or bypasses review, QA, delivery, or release gates.
5. **Deterministic gates and qualification freeze**
   - Purpose: Establish a clean evidence-backed commit before any paid provider
     call.
   - Changes: Run focused contract, adapter, core, observability, and live-E2E
     suites followed by quality ratchet, root check, browser/package/install
     gates as applicable. Record compatibility limitations, close S25, sync
     readiness, and freeze a replacement W66 qualification manifest.
   - Validation: `pnpm slice:gate -- W66-S25` passes with no provider call and
     W66-S09 becomes active only against the frozen behavior commit.
6. **Historical evidence disposition**
   - Purpose: Prevent earlier green runs from satisfying a materially stronger
     acceptance contract.
   - Changes: Mark every W66-S09 provider/guided result predating S20-S25 as
     diagnostic-only for final closure while retaining immutable hashes and
     factual findings. Require a fresh same-commit four-cell matrix after S25.
   - Validation: Qualification comparison and readiness ledger cannot select a
     pre-S20 result as a final passing cell.

### Acceptance criteria

1. Every negative weak-output fixture ends failed or blocked, never passed.
2. Failure classes and validator decisions are stable across supported adapter
   encodings.
3. Every supported structured-output family has positive and adversarial
   coverage.
4. Output repair, evidence reconciliation, and quality-repair retry remain
   bounded, exactly-once, workspace-safe, and review/QA preserving.
5. Raw provider payloads, credentials, private paths, and runtime state do not
   enter public fixtures or the commit.
6. Focused suites, quality ratchet, root check, and slice gate pass without paid
   provider calls.
7. All pre-S20 qualification runs are diagnostic-only for final W66 closure.
8. A replacement immutable qualification manifest points at the only commit
   eligible for W66-S09 execution.

### Done evidence

- Weak-output/evidence/verification adversarial corpus and expected-outcome map.
- Schema-family and provider-format parity reports.
- Repair concurrency, budget, and convergence regression output.
- Root/slice gate results and frozen W66-S09 qualification manifest.
- Historical-evidence disposition and synchronized backlog state.

### Out of scope

- Paid live provider calls, final four-cell results, provider/model promotion,
  W68 selection cutover, hosted execution, upstream delivery, or production
  clearance.

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
- **Hard dependencies:** W66-S25
- **External blocker:** W71-S14 qualification freeze is absent and the required Anthropic runner quota is unavailable.

  Both conditions must be explicitly re-evaluated before W66-S09 starts.
  W71-S14 must merge or consume the immutable `Улучшить UI и UX` handoff, pass
  the installed real-control-plane journeys, and freeze current qualification
  identities. Separately, the current Kimi-backed host failed claude-code
  adapter preflight with HTTP 403 before provider execution. Restored quota
  alone does not remove the W71-S14 prerequisite.
- **Primary user story surfaces:** DEV-01, DEV-04, AIP-12, OPS-06, OPS-07, FIN-03

### Local tasks

Planning reset on 2026-08-11: S20-S25 strengthen the accepted runner-output,
post-validation, structured-artifact, and repair-retry contracts. Every guided
or provider result predating that behavior chain remains immutable diagnostic
evidence but cannot satisfy the final W66-S09 four-cell closure.

Post-W70 audit reset on 2026-09-05: W71 restores evidence integrity and the
canonical installed lifecycle before another paid qualification attempt. No
W66-S09 cell may start until W71-S14 has merged the parallel UI refactor,
passed the real-control-plane black-box journeys, and frozen one current source,
target, profile, and evidence identity. Earlier evidence remains diagnostic and
does not grant release clearance.

1. **Installed guided proof baseline**
   - Purpose: Establish UI/UX and accessibility dimensions on the exact AOR commit used by all cells.
   - Changes: Run one installed guided proof with the S07 scenario contract and
     record its immutable evidence index without external network or source writes.
   - Validation: The proof passes action/readback, responsive, accessibility,
     reload/reconnect, and no-write criteria on the frozen commit.
2. **Sequential four-cell execution**
   - Purpose: Produce comparable provider qualification evidence without concurrent contamination.
   - Changes: Consume the exact W71-S14 qualification-freeze manifest and run
     medium Codex, medium Claude, large Codex, and large Claude in fresh isolated
     workspaces without changing any frozen source, target, package, UI handoff,
     profile, or proof identity.
   - Validation: Every cell matches all freeze digests and records actual
     provider/adapter/model/reasoning, terminal controller state, diagnostics,
     changed paths, delivery, and health.
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

### Medium-only qualification checkpoint — 2026-07-28

All evidence in this checkpoint predates W66-S11 and is diagnostic only. It
cannot count toward the final qualification matrix after the provider-session
behavior changes.

- Qualification commit:
  `088c806b0c081863828d7f6b3ac7c12ea4de9b6f`.
- Pinned `ky` target commit:
  `3419113b48e034fdcf8fa6bd3be3da7b3d0d758f`.
- Installed guided baseline:
  `w66-s09-guided-088c806b-20260728`, status `pass`, UI/UX `pass`,
  accessibility `pass`, and no-write checks `pass`.
  - Run summary SHA-256:
    `4222beb3ceb9805d9f01a352950b9a3cf5781d05975a6f65fba597480856ad90`.
  - Observation report SHA-256:
    `7b8c6e067b1cc55d9d7c36dd304d239211a8ae62410e3f4f7cce41ec6990b7fd`.
  - Run-health report SHA-256:
    `421ab0af14c407e3f93b02debaa1c33ede8f0d49c54355a9945e4cb5cd8c6070`.
  - Browser-task proof SHA-256:
    `2717f0980f033b3fc713ef8eef3dceac8ae7431af8c3fd92956522f4323c05f3`.
- `openai-primary.medium`:
  `w66-s09-openai-medium-088c806b-20260728`, status `passed`,
  `run_health=pass`, production proof `pass`, final assessment `pass`, and
  no-upstream-write checks `pass`.
  - Run summary SHA-256:
    `cc61e9ff919c6afeffd8e9b13c9e0b6f9118b241c3953d7dd92c5fcdf4ff6ff9`.
  - Observation report SHA-256:
    `1df83d072e7c6ad4e1fd29a05b9892ea7bec8d3f2245beafcbe0c036d42b87c8`.
  - Run-health report SHA-256:
    `a271d0ad82ae9e5922b1a3d120ab033ca9f54a8ca5c9735ec8bef493a910afbc`.
  - Final assessment SHA-256:
    `5294fce158b4d2db2375f215d8087089922cffc7037fbb8de75218665908644b`.
  - Qualification-cell report SHA-256:
    `8328e58f0c63b588e781efb888026b7d40625c730c03c46a2a10048be704bc03`.
- `anthropic-primary.medium`: `blocked` by a provider-owned
  `provider_context_window_exceeded` result after two fresh isolated attempts;
  target readiness and command health passed in both attempts, and neither
  attempt is recorded as a passing qualification cell.
  - Attempt `w66-s09-anthropic-medium-088c806b-20260728`: run summary SHA-256
    `1cdef5046706bf600d2aecacb9f4f179a75e3de76187ea0a53d5906c114e548c`;
    run-health SHA-256
    `74e39d6ccef2dcb2c4424a668779bce890eab6a456300f2c9926ba1403b08057`.
  - Attempt `w66-s09-anthropic-medium-088c806b-20260728-r2`: run summary
    SHA-256
    `6e50d511d3566208a758972031e736216792f03f17e4c1cb716b15f0be6ac947`;
    run-health SHA-256
    `822f1063cd9c1b8c68dbbcecc1fb31f20a7a662b51b6538f71cbe219144e5b40`.
- `openai-primary.large` and `anthropic-primary.large` were not run.
- This checkpoint does not update the committed pending closure index, does not
  close W66-S09, and does not grant release clearance. The release disposition
  remains `audit-hold` with `release_clearance=false`.

### Guided plus OpenAI-medium checkpoint — 2026-08-02

This checkpoint records the user-bounded qualification scope after W66-S19.
It is valid evidence for the frozen behavior commit, but it is not the complete
four-cell W66 matrix because Anthropic medium and both large cells were not run.

- Qualification commit:
  `c933235e046ef476707c7222ec4761223b86d937`.
- Pinned `ky` target commit:
  `3419113b48e034fdcf8fa6bd3be3da7b3d0d758f`.
- Frozen manifest SHA-256:
  `faf4de5e95131235023fdfa01ca7ffe99cf8481ca426cc227fb063f88bb3141d`.
- Installed guided baseline:
  `w66-s19-guided-c933235e-r1-20260802`, status `pass`,
  `run_health=pass`, primary verification `pass`, diagnostic verification
  `pass`, UI/UX and accessibility `pass`, and no-upstream-write checks `pass`.
  - Run summary SHA-256:
    `462ba170357d290314de1f74d5008a5a435a20d00da453bbc286ebee94716f8f`.
  - Observation report SHA-256:
    `ccd5604be7a1ecb9cf413b2cbd2458e7596b9a4f03d57462289f9695444741cf`.
  - Run-health report SHA-256:
    `2ad008351e6fcd8e2b9f5eb6d95dcd6142182b0c3c2adf8b5fe46a6a0559db45`.
  - Browser-task proof SHA-256:
    `7b0f4ecd283d87bf2b3866976dbc4e5f967f8df6c648d7755ddafaa91c23b495`.
- `openai-primary.medium`:
  `w66-s19-openai-medium-c933235e-r1-20260802`, status `passed`,
  `run_health=pass`, production proof `pass`, primary and diagnostic
  verification `pass`, final assessment all-pass, and no-upstream-write checks
  `pass`. The meaningful target diff is limited to `source/core/Ky.ts` and
  `source/types/retry.ts` in the disposable workspace.
  - Run summary SHA-256:
    `6526d48b72a58d0ea723bb45e947e503fcd009dc0646c08a98755669ed6c62ed`.
  - Observation report SHA-256:
    `c0e5e52e75f2bc4a74f5c395cf4a4b666678254f8ef38076c329d965827da178`.
  - Run-health report SHA-256:
    `1fce53e4da0f5ce2f0407e26b9bc64799f9a8639ab9610a5a7cd5a1bb4ba4c1b`.
  - Final assessment SHA-256:
    `42ef9b97ee19a4e70362ba0bbfd02d3b8594ecc2eb7ddeee5bfe6b169f450ae4`.
  - Qualification-cell report SHA-256:
    `1bc06981105803c640620c9d922282354409cf74a0f29d9348ebd63d6c159176`.
  - Qualification analysis SHA-256:
    `bb8960eb6841fa3d8867837aa196f479b47b5e14d02296726165449159351b16`.
- `anthropic-primary.medium`, `openai-primary.large`, and
  `anthropic-primary.large` were not run. No result is inferred for them.
- The local qualification set SHA-256 is
  `7eb5a844bbdf056cdfc34fe30d0626e94cfa4d9cc33a82b084bd6960ab0acedd`;
  its required matrix is blocked only by the three intentionally missing
  cells.
- At that checkpoint, the committed closure index remained pending, W66-S09
  remained `active`, and the release disposition remained `audit-hold` with
  `release_clearance=false`; the current checkpoint below supersedes it.

### Historical four-cell qualification checkpoint — 2026-08-11 (superseded)

The S20-S25 remediation chain is now merged and the fresh matrix ran against
one AOR commit and one pinned `ky` commit. Two Codex cells passed; both required
Anthropic cells are explicitly blocked at adapter preflight by the external
Kimi-backed runner quota. This checkpoint is honest blocked evidence, not a
partial W66 pass, and it does not authorize W67 entry.

- Qualification commit: `a329477c8dee616450d3732874155e8b4cfa34af`.
- Pinned `ky` target commit: `3419113b48e034fdcf8fa6bd3be3da7b3d0d758f`.
- Installed baseline `w66-s09-installed-a329477c`: `pass`, UI/UX `pass`,
  accessibility `pass`, and no-source-write `true`.
- `openai-primary.medium` and `openai-primary.large`: `pass`, with terminal
  health, production proof, final all-pass assessment, and no-upstream-write
  evidence.
- `anthropic-primary.medium` and `anthropic-primary.large`: `blocked`, with
  `run_health=blocked`, `production_proof=blocked`, `final_assessment=not-run`,
  and no-upstream-write `pass`. Both preflight attempts returned HTTP 403 for
  the host Kimi billing-cycle usage limit; provider execution and target
  mutation were not attempted.
- Path-neutral content-addressed evidence is committed in
  `docs/research/24-w66-live-qualification-evidence-index.json`, and the
  machine-readable closure is in
  `docs/research/25-w66-qualification-closure.json`.
- At that checkpoint readiness remained `status=blocked`,
  `gate_execution_status=pass`, `release_disposition=audit-hold`, and
  `release_clearance=false`, and W67-W70 were recorded as blocked. Their later
  deterministic development acceptance used the documented release-only
  qualification exception; W71 now supersedes this checkpoint while W66-S09
  remains the independent release blocker.

### Acceptance criteria

1. All four cells consume the exact W71-S14 freeze manifest and match its AOR,
   target, package, UI handoff, profile, proof, and artifact digests.
2. Every cell reaches terminal public lifecycle with `run_health=pass`.
3. Required diagnostics, review, QA, and delivery evidence pass.
4. Every cell has a validated final all-pass quality assessment.
5. Exact changed paths are meaningful, scoped, and evidence-backed.
6. Primary AOR/target checkouts and upstream remotes remain unchanged.
7. No credential value, paid judge transcript, raw runtime path, or private artifact is committed.
8. Any frozen-identity drift before or during the matrix invalidates and restarts all four final cells.
9. W66 closes only after the four-cell comparison and ledger-derived readiness decision are reproducible.

### Done evidence

- Four run summaries, observation reports, run-health reports, final quality assessments, and qualification cell reports.
- One same-commit comparison and path-neutral evidence index.
- W66 closure report, synchronized backlog, and readiness result.

### Out of scope

- New providers or target missions, hosted/distributed execution, credential
  storage, upstream delivery, npm/GitHub publication, and manual target fixes.
