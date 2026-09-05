# Wave 71 implementation slices — trust and canonical-flow recovery

## Purpose

W71 converts the post-W70 codebase audit into a release-blocking remediation
lane. It restores filesystem containment, deterministic repository gates,
truthful Task execution, concurrent-state integrity, bounded multirepo
integration, verifiable evidence, and current-version installed acceptance
before another W66-S09 provider qualification attempt.

The primary user outcome is:

`Project -> Task -> Prepare -> Start -> Work -> Review -> Complete`

That outcome must be executable through runtime-owned actions and durable
readback. Source-string tests, browser-owned lifecycle state, route-fulfilled API
mocks, screenshots, and synthetic packet assembly may support component or
fixture acceptance, but they do not close the integrated outcome.

## Parallel UI-refactor coordination

The separate `Улучшить UI и UX` workstream owns the Command Desk visual and
interaction refactor until its branch is merged. Its expected write set is:

- `apps/web/src/**`
- `apps/web/browser/**`
- `apps/web/test/**`
- generated `apps/web/dist/**`
- `docs/product/09-command-desk-task-workspace-refinement.md`

Every W71 slice before the final W71-S14 integration, including W71-S15, must
not make overlapping UI-composition edits while that workstream is active.
Those slices own contracts, projections, core/API behavior, state persistence,
multirepo execution, evidence, and non-visual tests. Missing UI data must be
recorded as a projection or contract requirement; the browser must not invent
lifecycle state, runner selection, safety mode, or success.

Before every W71 slice, the implementer must inspect the sibling task, branch,
and pull-request status, fetch `origin`, compare changed paths, and record one
of these dispositions in the slice handoff:

- `no-overlap`: proceed on the current W71 branch;
- `contract-handoff`: expose or consume an additive server contract without
  editing UI-owned files;
- `merge-first`: wait for the UI pull request, update from `origin/main`, and
  then reconcile integration-facing changes.

W71-S14 is the only planned integration owner for the combined UI/runtime
journey. It starts only after the UI refactor has merged or supplied an explicit
immutable handoff commit. It updates from `origin/main` before touching shared
web/browser surfaces and owns the final real-control-plane browser proof.

## Delivery order and release boundary

The repository keeps one active slice. The recommended topological order is
W71-S01 through W71-S06, W71-S09, W71-S07, W71-S08, W71-S10 through W71-S12,
W71-S15, W71-S13, and W71-S14. Investigation may run in parallel on disjoint
surfaces, but review, merge, state transition, and final validation remain
sequential.

W66-S09 stays blocked by the external Anthropic quota and remains the final
release-qualification action. No paid provider cells should run before
W71-S14 freezes the current source, target, profile, and evidence identities.
W71 development acceptance never grants release clearance by itself.

Effort labels include contracts, implementation, focused tests, source-of-truth
updates, and slice-gate evidence: `S` is roughly 1-2 engineering days, `M` is
roughly 2-4, and `L` is roughly 4-7. They are planning ranges, not acceptance
substitutes.

## W71-S01 — Audit disposition, proof scope, and coordination baseline

- **State:** done
- **Epic:** EPIC-0, EPIC-4, EPIC-5, EPIC-7
- **Hard dependencies:** W66-S25, W70-S10
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** audit/readiness ledgers, story coverage, backlog sources,
  production-readiness policy, bootstrap gate, and tests
- **Primary user story surfaces:** PBO-10, EMP-03, DEV-05, OPS-06, OPS-10,
  OPS-11, OPS-12, RMO-04, RMO-05, RMO-06, DTX-06, DTX-08, FIN-03

**Purpose:** Make the new audit findings and the parallel UI ownership boundary
visible to planning and release decisions before implementation begins.

**Changes:** Register the release-blocking findings, preserve the audit hold,
classify historical and fixture evidence honestly, downgrade unsupported story
claims, and make W71 the next deterministic backlog lane without rewriting W70
visual/component history.

### Local tasks

1. **Register the audit disposition.**
   - Purpose: Prevent the current release ledger from treating post-W70 findings as already remediated.
   - Changes: Add stable finding IDs, severity, affected invariants, owner slices, release impact, and current disposition to the canonical audit/readiness sources.
   - Validation: Production-readiness fixtures enumerate every open W71 blocker and retain `release_clearance=false`.
2. **Repair proof and story truth.**
   - Purpose: Separate implemented baselines from executable integrated proof.
   - Changes: Downgrade OPS-12, PBO-10, OPS-11, and the affected W62 multirepo claims; preserve older real-provider evidence only at its demonstrated historical scope.
   - Validation: Story/reference tests reject proof-covered claims without an allowed proof tier and current artifact identity.
3. **Record the UI coordination contract.**
   - Purpose: Avoid conflicting changes while the sibling task refactors Command Desk and Task Workspace.
   - Changes: Record owned paths, contract-handoff rules, merge-first checkpoints, and W71-S14 integration ownership in backlog and handoff guidance.
   - Validation: The W71 plan names no pre-S14 task that requires overlapping UI-composition writes.
4. **Open the deterministic queue.**
   - Purpose: Make remediation selectable while W66-S09 remains externally blocked.
   - Changes: Register W71 consistently in the roadmap, master backlog, epic map, and dependency graph.
   - Validation: `pnpm slice:status` and `pnpm slice:next` select W71-S01 with one ready slice and no dependency drift.
5. **Bootstrap a trustworthy remediation gate.**
   - Purpose: Prevent the first filesystem fix from being accepted by the known false-green typecheck and incomplete static/test coverage.
   - Changes: Add a slim pre-remediation gate that fails on spawn error, signal, timeout, or non-zero exit and accounts for every changed source/test file through focused lint, typecheck, and test execution; leave dependency policy, performance isolation, and full historical coverage expansion to S03.
   - Validation: Missing compiler/test binaries, silent non-zero exits, signals, timeouts, and an untracked changed source/test file all fail; the command reports the exact files and checks that ran.

### Acceptance criteria

1. Every release-blocking audit finding has a stable owner slice and is visible in readiness output.
2. Current story statuses distinguish baseline, fixture, integrated-local, and live-provider evidence.
3. The UI workstream and W71 have non-overlapping ownership until the explicit S14 integration checkpoint.
4. W66-S09 remains blocked and cannot inherit stale pre-W71 evidence.
5. S02 can validate path-safety changes with a fail-hard changed-file gate even before S03 completes the repository-wide gate remediation.

### Done evidence

- machine-readable audit/readiness disposition and focused tests
- updated story coverage with explicit gaps and owner slices
- synchronized roadmap, master backlog, epic map, and dependency graph
- bootstrap gate failure fixtures and changed-file execution manifest
- `pnpm slice:status`
- `pnpm slice:plan -- W71-S02`
- `pnpm slice:gate`

### Out of scope

- Runtime or UI remediation.
- Rewriting W70 historical implementation evidence.
- Paid provider execution or release publication.
- Full dependency, Node-matrix, performance, and historical source-coverage remediation owned by S03.

## W71-S02 — Symlink-safe path confinement and durable cleanup

- **State:** done
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-5
- **Hard dependencies:** W71-S01
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** path-containment contracts and helpers, intent Markdown
  ingress, workspace-set cleanup, integration evidence paths, security tests
- **Primary user story surfaces:** PBO-05, SEC-04, DTX-05, FIN-03

**Purpose:** Ensure every repository-derived read, copy, materialization, and
recursive cleanup remains inside its canonical owned root under symlinks,
renames, restarts, and adversarial manifests.

**Changes:** Introduce one symlink-aware canonical containment primitive, apply
it to Markdown and runtime paths, and persist cleanup transitions so retry and
restart cannot escape or misreport ownership.

### Local tasks

1. **Define canonical path ownership.**
   - Purpose: Give contracts and runtime one fail-closed containment rule.
   - Changes: Specify canonical roots, allowed path kinds, symlink policy, no-follow reads, owner markers, and cleanup transition semantics.
   - Validation: Contract examples cover traversal, sibling prefix, symlink, missing path, and corrupted ownership state.
2. **Harden repository and evidence reads.**
   - Purpose: Prevent local-file disclosure through project-controlled paths.
   - Changes: Resolve real paths, reject or safely open symlinks, bind validation to the opened file identity, and remove lexical-only containment decisions.
   - Validation: Swap/TOCTOU, symlink, nested symlink, and outside-root canary tests fail closed.
3. **Harden workspace operations and cleanup.**
   - Purpose: Prevent copied or deleted paths from escaping AOR-owned runtime roots.
   - Changes: Derive workspace, marker, execution, and output paths from the canonical runtime owner; persist `deleting`, `deleted`, and `delete-failed` atomically.
   - Validation: Restart/retry cleanup and forged-marker tests preserve external sentinels and primary checkouts.
4. **Audit all filesystem sinks.**
   - Purpose: Avoid fixing only the known Markdown and workspace call sites.
   - Changes: Inventory recursive delete/copy, evidence read, patch apply, and materialization sinks and route them through the shared primitive.
   - Validation: A tracked manifest test fails when an unreviewed filesystem sink bypasses the containment owner.

### Acceptance criteria

1. Repository Markdown cannot resolve outside the selected canonical project root.
2. No recursive delete, copy, patch, or evidence read trusts a manifest path without canonical ownership validation.
3. Cleanup is restart-idempotent and corruption never opens access.
4. External sentinels, project roots, and primary checkouts remain unchanged in all adversarial tests.

### Done evidence

- path-containment contract and examples
- focused Markdown, workspace, integration, and cleanup adversarial tests
- filesystem-sink inventory/ratchet
- `pnpm slice:gate`

### Out of scope

- General sandboxing of provider processes.
- UI visual or interaction refactoring.
- Real upstream deletion or delivery tests.

## W71-S03 — Deterministic repository gate and dependency/process safety

- **State:** done
- **Epic:** EPIC-0, EPIC-5, EPIC-7
- **Hard dependencies:** W71-S02
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** package/lockfile, dependency policy, test/typecheck
  runners, process supervision, CI and release gates
- **Primary user story surfaces:** OPS-06, OPS-07, SEC-04, FIN-03

**Purpose:** Make the canonical gate trustworthy on every supported Node version
and prevent dependency, compiler, CLI-test, or network-process failures from
being reported as successful or hanging indefinitely.

**Changes:** Patch the high-severity development dependency, fail on all process
errors, separate load-sensitive timing from correctness, bound external
commands, and expose actual lint/type/test coverage.

### Local tasks

1. **Repair dependency safety.**
   - Purpose: Remove known high-severity advisories and keep them out of release inputs.
   - Changes: Upgrade the affected `fast-uri` dependency path, add full and production audits to policy, and define owned expiring exceptions.
   - Validation: Frozen install plus production and full high-severity audits pass from a clean checkout.
2. **Make process failures authoritative.**
   - Purpose: Stop typecheck and delivery wrappers from ignoring spawn or exit failures.
   - Changes: Treat spawn errors, signals, non-zero status, timeout, and credential prompts as typed failures; set bounded local/network budgets.
   - Validation: Fake compiler and command fixtures cover missing binary, signal, silent non-zero exit, timeout, and prompt suppression.
3. **Stabilize repository tests.**
   - Purpose: Remove load-dependent correctness failures and whole-group timeout ambiguity.
   - Changes: Split the CLI mega-group where needed and move wall-clock performance assertions to isolated repeatable measurements. Normalize the initial public runtime contract to Node 22.x (`>=22 <23`) across package metadata, README, CI, and release smoke unless the same slice adds and passes equivalent installed-CLI gates for each newer version before expanding the range.
   - Validation: Three consecutive clean gates pass with diagnostic time reserve on every advertised Node version; package engines, docs, CI, and release verification reject any untested version consistently.
4. **Expose gate coverage.**
   - Purpose: Make a passing gate say which source and test files actually ran.
   - Changes: Extend the execution manifest with lint, typecheck, unit, browser, and excluded-file ownership data.
   - Validation: Adding an untracked source/test candidate or expired exclusion fails the gate.

### Acceptance criteria

1. Frozen dependency installation and both audit modes pass without high-severity findings.
2. Any failed, signaled, missing, or timed-out child process fails the owning command with typed evidence.
3. `pnpm check` passes three consecutive clean runs on every version allowed by package engines, with Node 22.x as the required initial baseline and no untested open-ended range.
4. Gate reports identify the exact source and test coverage rather than source markers.

### Done evidence

- clean dependency audit reports and lockfile diff
- process-failure and timeout fixtures
- repeated Node-matrix gate reports
- gate coverage manifest and self-test
- `pnpm slice:gate`

### Out of scope

- Hotspot decomposition, owned by W71-S15 and measured follow-up slices.
- Provider qualification and paid calls.
- UI presentation changes.

## W71-S04 — Versioned Task contract and execution-route truth

- **State:** done
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W71-S03
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** Task product/contract docs, intent and Task projections,
  control-plane API/OpenAPI, CLI parity, examples and contract tests
- **Primary user story surfaces:** PBO-09, PBO-10, DEV-01, OPS-01, OPS-12

**Purpose:** Make Prepared Task expose the exact versioned contract that Start
will execute without confusing intake normalization with approved execution.

**Changes:** Define stable Task identity and states; project outcome,
acceptance, scope, write-back mode, revisions, route selection, readiness, and
server-owned actions; preserve additive compatibility for existing clients.

### Local tasks

1. **Specify Task identity and state.**
   - Purpose: Give reload, retry, and completion one durable object identity.
   - Changes: Define Task-to-intent/Flow/run lineage, legal states, revision ownership, and compatibility for pre-W71 Task projections.
   - Validation: State-transition and migration fixtures reject ambiguous or regressive identity.
2. **Specify the Prepared contract.**
   - Purpose: Let the operator review what will actually run.
   - Changes: Add outcome, acceptance criteria, scope, delivery mode, normalization revision, approved execution route, readiness revision, and explicit write effects.
   - Validation: Contract tests reject missing execution identity and distinguish no-write from write-capable approval.
3. **Separate and close intake and execution routes.**
   - Purpose: Prevent normalization provider metadata from masquerading as the selected runner.
   - Changes: Close the provider-route `step` enum and execution statuses in the shared contract before projecting provider-neutral approved route IDs; make `start` the only start action and keep model/effort translation at adapter boundaries.
   - Validation: Unknown route steps/statuses fail at contract validation, and route-policy plus OpenAPI/CLI parity tests prove no provider string bypasses route approval.
4. **Publish the UI handoff.**
   - Purpose: Let the parallel UI refactor consume real server fields without overlapping implementation.
   - Changes: Produce a compact projection fixture and field/status handoff; do not edit UI-owned files before merge-first coordination.
   - Validation: The sibling UI task can render every state from the fixture without browser-owned defaults.

### Acceptance criteria

1. Prepared Task contains the exact outcome, acceptance, scope, write-back mode, route, readiness, and revision used by Start.
2. Intake-normalization route data cannot appear as approved execution selection.
3. `Start task` maps to the canonical `start` action and carries expected revision.
4. CLI, API, OpenAPI, examples, and projection fixtures agree.

### Done evidence

- versioned Task contract and compatibility note
- positive, negative, migration, and route-policy fixtures
- control-plane/OpenAPI/CLI parity output
- immutable projection handoff for the UI workstream
- `pnpm slice:gate`

### Out of scope

- Visual composition, CSS, tokens, responsive layout, or accessibility styling.
- Starting execution or implementing Ask AOR.
- Provider-specific model/effort translation in core.

## W71-S05 — Atomic intent and runtime state transactions

- **State:** done
- **Epic:** EPIC-0, EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W71-S04
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** intent preparation, run/step state ownership, adapter
  heartbeat supervision, shared locks/atomic storage, recovery tests
- **Primary user story surfaces:** EMP-05, DEV-05, OPS-01, OPS-02, OPS-11,
  OPS-12, FIN-03

**Purpose:** Eliminate duplicate paid work and lost pause/resume/steer/request
updates by giving every shared mutable state transition one transaction owner.

**Changes:** Standardize file transactions with locks, atomic writes, revisions
and fencing; make preparation idempotent; isolate heartbeat writes; preserve
corruption and persistence failures as recovery evidence.

### Local tasks

1. **Define shared state transactions.**
   - Purpose: Replace inconsistent read-modify-write helpers with one reviewed primitive.
   - Changes: Specify lock scope, revision/fencing semantics, atomic persistence, corruption quarantine, and retry/idempotency keys.
   - Validation: Fault injection covers crash points before write, after write, before rename, and after rename.
2. **Make intent preparation single-owner.**
   - Purpose: Prevent duplicate provider calls and overwritten normalization revisions.
   - Changes: Add submission/attempt locks, stable attempt identities, stale-revision rejection, and idempotent result reuse.
   - Validation: Multi-process contention produces one provider invocation and one ordered revision lineage.
3. **Isolate provider status updates.**
   - Purpose: Prevent heartbeat writes from rolling back operator controls.
   - Changes: Move status to a sidecar or update only provider-owned fields through the run-control transaction owner; surface persistence failures.
   - Validation: Heartbeat races with pause, resume, steer, cancel, approval, and operator requests without lost fields.
4. **Adopt and ratchet the primitive.**
   - Purpose: Prevent new shared-state writers from bypassing ownership.
   - Changes: Migrate affected runtime writers and add a tracked direct-write exception manifest with owner and expiry.
   - Validation: Source/gate checks reject unowned direct writes to shared mutable state.

### Acceptance criteria

1. Concurrent preparation cannot duplicate provider work or overwrite a revision.
2. Heartbeat and final provider status cannot roll back operator-owned control state.
3. Corrupt state always blocks or enters explicit recovery; it is never interpreted as empty.
4. Repeated contention tests report zero lost transitions.

### Done evidence

- state-transaction contract and shared primitive
- fault-injection and multi-process stress reports
- intent idempotency and heartbeat/control race tests
- direct-write ownership ratchet
- `pnpm slice:gate`

### Out of scope

- Multirepo scope semantics, owned by W71-S09.
- UI layout or component work.
- Distributed database or hosted control-plane storage.

## W71-S06 — Closed delivery, release, route, and scope validation

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-5
- **Hard dependencies:** W71-S05
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** public contracts and examples, contract family registry
  and loaders, shared evidence storage/resolver, Runtime Harness ingestion,
  provider routing and negative tests
- **Primary user story surfaces:** DEV-01, SEC-04, RMO-04, RMO-05, DTX-04,
  DTX-07, DTX-08, FIN-03

**Purpose:** Reject artifacts at the contract boundary whenever runtime cannot
safely execute or interpret them.

**Changes:** Close status/step enums, validate nested delivery and release data,
add cross-field and cross-packet invariants, and define one canonical scope
grammar for later locking and integration.

### Local tasks

1. **Close delivery and release status enums.**
   - Purpose: Reject unknown transaction behavior before Runtime Harness execution.
   - Changes: Enforce delivery, release, review, and run-result statuses in shared family validation; consume the already closed execution-route vocabulary from S04.
   - Validation: Status mutation fixtures fail at `contract validate` with stable error codes.
2. **Validate nested transaction artifacts.**
   - Purpose: Prevent null repository results, empty approvals, and missing evidence from appearing successful.
   - Changes: Add specialized delivery/release validators and partial/blocked/success cross-field invariants.
   - Validation: Adversarial examples cover null items, empty lineage, missing verification, and contradictory transaction outcomes.
3. **Bind packet identities.**
   - Purpose: Prevent artifacts from one run, unit, repository, or attempt closing another.
   - Changes: Validate project/run/task/unit/attempt/repository ownership, required digests, and referenced authority.
   - Validation: Mismatched identity and replay fixtures fail closed.
4. **Define canonical path scopes.**
   - Purpose: Give contracts, locks, provisioner, and integration one overlap model.
   - Changes: Specify segment-aware glob grammar, normalization, invalid-pattern behavior, and exact changed-path comparison.
   - Validation: Positive/negative overlap corpus covers nested, wildcard-middle, sibling-prefix, empty, and invalid patterns.
5. **Define and implement resolvable evidence references.**
   - Purpose: Let review, delivery, integration, and later qualification share one immutable reference contract rather than invent temporary formats.
   - Changes: Specify allowed evidence schemes, canonical ownership, immutable byte identity, digest algorithm, run/task/unit/attempt/repository bindings, redaction metadata, and resolution failures; implement the shared storage/resolver and migrate review/integration-facing producers before S08 or S10 consumes it.
   - Validation: Real stored bytes resolve with verified digests and identity; contract/runtime fixtures reject missing, mutable, path-bearing, unowned, mismatched, and unresolvable references before downstream consumers run.

### Acceptance criteria

1. Every runtime-invalid delivery, release, route, or scope artifact is rejected by the shared contract layer.
2. Unknown status or route step cannot pass as success.
3. Cross-packet ownership and digest mismatches have stable blocking errors.
4. All canonical examples pass and all adversarial examples fail for the intended reason.
5. S08 and S10 can resolve review and delivery evidence through the versioned S06 contract without a temporary reference shape.

### Done evidence

- updated contracts, examples, family registry, and specialized validators
- mutation and cross-packet ownership tests
- Runtime Harness invalid-ingestion tests
- shared evidence storage/resolver and byte-verification tests
- reference/index/OpenAPI parity output
- `pnpm slice:gate`

### Out of scope

- Public multirepo command implementation.
- UI review/diff presentation.
- Live-provider qualification.

## W71-S07 — Server-owned Task start and action progression

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W71-S06
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** intent confirmation/start, Task/Flow projections,
  lifecycle mutation handlers, control-plane client contract and focused tests
- **Primary user story surfaces:** PBO-09, PBO-10, DEV-01, OPS-01, OPS-12

**Purpose:** Make Prepare-to-Start create exactly one durable Flow-backed Task
and let the server own every subsequent primary action.

**Changes:** Implement atomic idempotent confirm-and-start, durable Task/Flow
readback, generic action dispatch, stale revision errors, and reload-safe state
without editing the parallel workstream's visual composition.

### Local tasks

1. **Unify confirm and start.**
   - Purpose: Remove the path where UI reports Active while discovery never starts.
   - Changes: Route `start` through one idempotent transaction that confirms the reviewed revision and creates or resumes exactly one discovery/Flow lineage.
   - Validation: Duplicate, concurrent, stale, retry-after-timeout, and restart cases preserve one identity and one side effect.
2. **Project durable Task lineage.**
   - Purpose: Let every client recover the same Task after reload.
   - Changes: Return Task, intent, Flow, run/job, state, revision, and evidence references from the canonical projection.
   - Validation: API/CLI readback survives process restart and contains no browser-only state.
3. **Generalize primary actions.**
   - Purpose: Avoid a client allowlist that makes new lifecycle states unreachable.
   - Changes: Publish typed server-owned action IDs, payload requirements, permissions, and durable success references through one mutation boundary; derive mutation dispatch from the canonical action catalog rather than a hand-maintained allowlist.
   - Validation: Catalog-generated parity tests execute every published action needed by no-write and change-capable discovery, specification, planning, approval, execution, QA, review, delivery, retry, and completion paths.
4. **Prepare the UI contract handoff.**
   - Purpose: Minimize later overlap with the Command Desk refactor.
   - Changes: Publish server contract examples and an explicit S14 wiring handoff outside `apps/web/**`; do not modify client code, browser fixtures, generated web assets, or UI product docs.
   - Validation: Changed-path review proves S07 contains no UI-owned path and the handoff enumerates every catalog action plus payload/readback shape required by S14.

### Acceptance criteria

1. One Start creates exactly one durable Flow/run lineage and returns its identity.
2. Stale Start returns conflict and creates no Mission, Flow, job, or provider call.
3. Reload and process restart preserve the server-owned Task state and next action.
4. Every action published by the canonical Task/Flow projection is accepted by the mutation facade and leaves durable readback or a typed blocking result.
5. No client may declare Active or Completed without durable server evidence.

### Done evidence

- intent/start transaction and concurrency tests
- Task/Flow durable readback fixtures
- generic primary-action contract and parity tests
- UI wiring handoff with overlap disposition
- `pnpm slice:gate`

### Out of scope

- Command Desk layout, styling, responsive behavior, or component redesign.
- Ask AOR execution and final completion, owned by W71-S08.
- Real-provider runs.

## W71-S08 — Durable Ask AOR, review, and completion

- **State:** blocked
- **Epic:** EPIC-2, EPIC-4, EPIC-5, EPIC-6
- **Hard dependencies:** W71-S07
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** operator requests, review/verification/delivery closure,
  Task projections and mutation handlers, recovery and focused integration tests
- **Primary user story surfaces:** DEV-05, DEV-06, RQA-02, OPS-04, OPS-11,
  OPS-12, DTX-01, DTX-04

**Purpose:** Close Work-to-Review-to-Complete with real run-owned evidence and
make Ask AOR a resumable execution rather than a created-but-idle request.

**Changes:** Add idempotent create-and-run or durable run-pending semantics,
bind request/retry lineage, enforce review/verification/delivery prerequisites,
and keep completed Tasks immutable.

### Local tasks

1. **Make Ask AOR executable and resumable.**
   - Purpose: Ensure one user submission results in one bounded runtime request outcome.
   - Changes: Atomically create and schedule the operator request or persist explicit `run-pending`; resume safely after restart and return durable refs.
   - Validation: Duplicate submit, crash-before-run, crash-after-run, and retry tests produce one request identity and bounded attempts.
2. **Bind review to actual evidence.**
   - Purpose: Prevent fixture or browser-created diff/check state from approving work.
   - Changes: Require canonical review reads to resolve actual patch/diff, checks, Runtime Harness, risk, and decision evidence.
   - Validation: Missing, stale, mismatched, binary, truncated, and failed verification states remain explicit and cannot close.
3. **Enforce completion prerequisites.**
   - Purpose: Make Completed mean the declared Task outcome passed its required gates.
   - Changes: Gate completion on review decision, verification, delivery mode/result, and immutable evidence lineage; create follow-up as a new Task.
   - Validation: Transition tests reject premature completion and any mutation of completed history.
4. **Exercise recovery.**
   - Purpose: Prove Attention and retry preserve identity rather than inventing a new Task.
   - Changes: Add fail-once, offline/reconnect, stale revision, request retry, and repair-attempt scenarios.
   - Validation: Recovery retains Task/unit identity, creates a new attempt where required, and exposes one server-owned next action.

### Acceptance criteria

1. Ask AOR always reaches running/terminal state or an explicit resumable run-pending state.
2. Duplicate submit/retry cannot duplicate completed work.
3. Review and completion consume real run-owned diff, check, decision, delivery, and evidence artifacts.
4. Completed Tasks are immutable and follow-up work receives a new identity.

### Done evidence

- operator-request transaction/restart tests
- actual review-read and completion prerequisite fixtures
- fail-once recovery and retry lineage tests
- no-write and patch-only service-level journey reports
- `pnpm slice:gate`

### Out of scope

- Visual presentation of Activity, Attention, Changes, Checks, or Evidence.
- Multirepo provisioning and integration.
- Upstream delivery or live-provider proof.

## W71-S09 — Canonical multirepo scope locks and isolated integration

- **State:** blocked
- **Epic:** EPIC-0, EPIC-3, EPIC-5
- **Hard dependencies:** W71-S06
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** multirepo coordination, workspace provisioner,
  integration service, Git evidence, contracts and concurrency tests
- **Primary user story surfaces:** EMP-03, RMO-03, RMO-04, RMO-05, RMO-06,
  DTX-05, DTX-06, DTX-08, SEC-04

**Purpose:** Ensure conflicting repository writers cannot run together and
integration cannot mutate a child checkout or trust a child-declared scope.

**Changes:** Adopt canonical scope algebra, make locks atomic and fail-closed,
create an independent integration worktree/clone, and bind outputs to measured
Git evidence and authoritative unit ownership.

### Local tasks

1. **Implement shared scope intersection.**
   - Purpose: Make contract, provisioner, scheduler, and lock decisions identical.
   - Changes: Implement segment-aware glob normalization and overlap using the W71-S06 grammar; treat ambiguity as conflict.
   - Validation: The shared corpus proves nested, wildcard-middle, sibling-prefix, equal, disjoint, invalid, and empty cases.
2. **Make multirepo locks transactional.**
   - Purpose: Prevent concurrent writers from both winning read-check-write races.
   - Changes: Use the shared state transaction, atomic persistence, fencing, corruption quarantine, expiry, and ownership evidence.
   - Validation: Multi-process tests produce exactly one winner for overlapping scope and allow safe disjoint writers.
3. **Isolate integration Git state.**
   - Purpose: Preserve child workspace evidence and indexes during integration.
   - Changes: Replace recursive detached-worktree copying with a real independent worktree/clone and verify distinct gitdir/index ownership.
   - Validation: Integration leaves source HEAD, index, status, and bytes unchanged for patch and commit outputs.
4. **Verify authoritative outputs.**
   - Purpose: Prevent a child from applying another repository's commit or undeclared paths.
   - Changes: Bind output to child run/attempt/unit/repo, validate commit object and ancestry, measure actual diff, and compare exact paths/digests to allowed scope.
   - Validation: Cross-repo, unrelated-commit, dishonest-path, digest, and out-of-scope fixtures block parent closure.

### Acceptance criteria

1. Atomic lock acquisition has zero duplicate winners under repeated process contention.
2. Contracts, provisioner, scheduler, lock manager, and integration share one scope implementation.
3. Integration never changes source child or primary checkouts.
4. Passing output evidence contains measured commit/diff/path/digest identity bound to the authoritative unit and repository.

### Done evidence

- canonical scope implementation and corpus
- multi-process lock/corruption stress report
- detached-worktree integration regression reproduction and fix tests
- authoritative output and actual-diff adversarial tests
- `pnpm slice:gate`

### Out of scope

- Public provision/integrate orchestration, owned by W71-S10.
- Portfolio orchestration across independent AOR projects.
- Upstream multi-repository delivery.

## W71-S10 — Public workspace provision-to-integration lifecycle

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-4, EPIC-5, EPIC-6
- **Hard dependencies:** W71-S08, W71-S09
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** workspace/parent-run contracts, CLI/API/OpenAPI, parent
  scheduler, integration/report application, delivery projections and black-box tests
- **Primary user story surfaces:** EMP-03, DEV-01, DEV-05, OPS-01, OPS-10,
  RMO-04, RMO-05, RMO-06, DTX-06, DTX-08

**Purpose:** Make structured multirepo execution reachable from public AOR
surfaces without manually manufacturing workspace or authority reports.

**Changes:** Expose bounded provisioning, launch children from the owned
workspace set, automatically integrate terminal outputs, apply the authority
report through CAS, and materialize aggregate/per-repository delivery evidence.

### Local tasks

1. **Expose bounded workspace provisioning.**
   - Purpose: Remove the requirement for an externally pre-created ready workspace set.
   - Changes: Add versioned CLI/API/OpenAPI commands with project/run identity, dry-run/readback, permissions, and typed failure outcomes.
   - Validation: Public parity tests cover monorepo, multirepo, dirty checkout, overlap, partial provision, retry, and cleanup.
2. **Connect parent scheduling to integration.**
   - Purpose: Let terminal child results advance the parent without private function calls.
   - Changes: Gather authoritative outputs, invoke integration once, apply the report with CAS, and preserve stale/repair ownership and budgets.
   - Validation: Duplicate events, restart, partial child failure, stale task, and exhausted repair budget remain deterministic.
3. **Materialize coordinated delivery truth.**
   - Purpose: Tie parent completion to aggregate and repository-specific validation results.
   - Changes: Produce delivery/release inputs from measured integration evidence and block partial effects from appearing successful.
   - Validation: Contract and projection tests resolve every per-repository result and rollback/recovery reference.
4. **Prove the public path.**
   - Purpose: Demonstrate that production callers, not only unit tests, invoke provisioner and integrator.
   - Changes: Build a disposable two-repository scenario using only installed public commands/API and deterministic adapters.
   - Validation: The journal contains provision, child attempts, contention, retry, integration, aggregate checks, delivery evidence, cleanup, and no upstream writes.

### Acceptance criteria

1. A clean public command/API path provisions a workspace set and completes parent integration without private imports or handcrafted authority artifacts.
2. Retry/restart remains idempotent and preserves task, unit, attempt, workspace, and parent lineage.
3. One invalid repository/path/digest/verification result blocks aggregate closure.
4. Source repositories remain unchanged and no upstream write occurs.

### Done evidence

- CLI/API/OpenAPI provision/integrate contracts and parity tests
- scheduler/integration CAS and recovery tests
- aggregate/per-repository delivery evidence fixtures
- installed two-repository black-box report and command journal
- `pnpm slice:gate`

### Out of scope

- Hosted control-plane coordination.
- Unbounded repository graphs or cross-project portfolio scheduling.
- Credentialed upstream writes.

## W71-S11 — Resolvable evidence and adversarial qualification proof

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W71-S10
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** qualification evidence bindings/freshness, W66 readiness
  and adversarial proof, live-E2E target materialization, profiles and proof tests
- **Primary user story surfaces:** AIP-06, OPS-06, OPS-07, FIN-03, FIN-04

**Purpose:** Make every qualification claim independently verifiable against
real artifact bytes and the exact behavior commit.

**Changes:** Resolve immutable evidence references, verify bytes/digests and
ownership, apply freshness to all cell states, run each family through its real
validator, and align the live harness with central AOR Home and current Task flow.

### Local tasks

1. **Bind qualification evidence to the shared resolver.**
   - Purpose: Replace shape-only qualification digest checks with the independently retrievable S06 evidence implementation already used by review and integration.
   - Changes: Route W66/live-E2E evidence through shared storage/ref resolution and add cell/profile/source/target identity, retention, portability, and qualification-specific redaction checks.
   - Validation: Missing, moved, mutated, mismatched, and unresolvable qualification artifacts fail closed, while S08/S10 references continue to resolve without migration.
2. **Enforce universal freshness.**
   - Purpose: Prevent blocked or partial matrices from retaining passing cells after behavior changes.
   - Changes: Apply source/target/profile/proof freshness to pending, blocked, passed, and failed cells; classify prior evidence as stale/diagnostic-only.
   - Validation: Changing any frozen identity resets usable passing count and explains the invalidation.
3. **Run real per-family adversarial proof.**
   - Purpose: Ensure the reported family coverage executes each owning validator/materializer.
   - Changes: Give every family distinct positive, negative, repaired, and concurrency cases with validator/case IDs and mutation sensitivity.
   - Validation: Breaking one family or hardcoding a result necessarily fails the proof and its focused test.
4. **Align the rehearsal environment.**
   - Purpose: Qualify the current product rather than legacy target-local runtime behavior.
   - Changes: Use central AOR Home, forbid implicit target `.aor`, and cover Task prepare/start, Ask AOR, review, delivery, release, and learning stages.
   - Validation: Installed harness contract tests prove target cleanliness and complete evidence lineage without upstream writes.

The S11 proof output validates the tooling and becomes diagnostic when later
W71 implementation commits change source identity. W71-S14 must rerun the full
adversarial proof on the final integrated commit before creating the freeze.

### Acceptance criteria

1. Every accepted evidence digest is recomputed from resolved immutable bytes.
2. Any frozen identity change invalidates every incompatible cell regardless of status.
3. W66 adversarial proof executes and identifies the real validator for every claimed family.
4. Current live profiles use central AOR Home and include the canonical Task lifecycle required for release qualification.

### Done evidence

- evidence storage/resolution contract and adversarial tests
- W66 freshness reset and byte-verification tests
- per-family mutation/concurrency proof report
- current live-E2E profile and target-cleanliness fixtures
- `pnpm w66:proof`
- `pnpm slice:gate`

### Out of scope

- Paid provider execution.
- Public hosting of evidence artifacts.
- UI visual acceptance, owned by the sibling workstream and W71-S14 integration.

## W71-S12 — Enforceable quality coverage and maintainability ratchets

- **State:** blocked
- **Epic:** EPIC-0, EPIC-7
- **Hard dependencies:** W71-S11
- **Remediation priority:** P1
- **Estimated effort:** M
- **Primary modules:** lint/type/coverage/complexity tooling, ownership and
  exception manifests, critical-path quality tests
- **Primary user story surfaces:** repository-quality enablement without direct
  story closure

**Purpose:** Turn the current grandfathered quality baseline into a measurable
debt-reduction mechanism focused on safety- and workflow-critical code.

**Changes:** Expand lint/type coverage, fail on new complexity/clone/dead code,
time-box exceptions, and establish critical-path coverage without mixing
structural refactoring into the ratchet rollout.

### Local tasks

1. **Expose and ratchet static coverage.**
   - Purpose: Make passing lint/type gates cover the code changed by each slice.
   - Changes: Separate boundary lint from ESLint, add all production files to a coverage manifest, and require changed-file ESLint/checkJs or an owned expiring exception.
   - Validation: New or moved production files cannot bypass lint/type accounting.
2. **Ratchet structural debt.**
   - Purpose: Prevent additional large, deeply nested, cloned, or complex code.
   - Changes: Add measurable complexity, function length, nesting, clone, dead-code, and file-ceiling baselines with owner and expiry.
   - Validation: Mutation fixtures prove each class can fail the gate; baseline counts cannot increase.
3. **Establish critical-path coverage.**
   - Purpose: Measure branch protection around path, state, contract, integration, and Task lifecycle invariants.
   - Changes: Add coverage reporting and minimums for critical modules without using repository-wide vanity targets.
   - Validation: Removing a critical negative-path test or branch drops the focused gate below threshold.
4. **Make exceptions expire and drive the next extraction.**
   - Purpose: Keep the baseline from becoming a permanent waiver list.
   - Changes: Require owner, rationale, ceiling, expiry, and successor slice for every exception; nominate the largest release-critical eligible hotspot for S15 without changing it in S12.
   - Validation: Missing/expired ownership fails the gate and the S15 target is selected from measured, reproducible debt data.

### Acceptance criteria

1. Every changed production file is linted and typechecked or has an owned unexpired migration exception.
2. Complexity, clone, dead-code, and file-size debt cannot increase.
3. Critical repaired invariants have branch-level coverage evidence.
4. Every remaining exception has an owner, expiry, non-increasing ceiling, and a backlog successor.

### Done evidence

- static coverage and debt manifests with owner/expiry
- focused coverage and mutation reports
- before/after quality-ratchet metrics
- `pnpm quality:ratchet`
- `pnpm slice:gate`

### Out of scope

- Eliminating every historical diagnostic in one slice.
- Refactoring production hotspots, owned first by W71-S15 and then by measured follow-ups.
- A new web design system or UI redesign.
- Provider performance optimization.

## W71-S15 — Live-E2E flow hotspot decomposition

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W71-S12
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `scripts/live-e2e/lib/flows.mjs`, extracted flow modules,
  characterization tests, import-boundary and size ratchets
- **Primary user story surfaces:** repository-quality enablement without direct
  story closure

**Purpose:** Reduce the change radius of the largest production flow hotspot
before final installed acceptance without combining unrelated refactors.

**Changes:** Characterize `scripts/live-e2e/lib/flows.mjs`, extract cohesive
flow families behind stable internal interfaces, preserve public journal and
artifact behavior, and ratchet the original file plus new module boundaries.

### Local tasks

1. **Freeze current behavior.**
   - Purpose: Make structural extraction reviewable independently from behavior changes.
   - Changes: Add characterization coverage for exported flows, error taxonomy, cleanup, journal order, evidence refs, and no-write/upstream-write invariants.
   - Validation: Existing and new characterization suites agree on outputs for representative success, blocked, failed, repair, and restart cases.
2. **Define extraction seams.**
   - Purpose: Split by owned flow responsibility rather than arbitrary line count.
   - Changes: Map lifecycle, workspace, provider, review/delivery, and evidence dependencies; choose the smallest cohesive family or families that bring `flows.mjs` below the S12 ceiling without cycles.
   - Validation: Import-graph checks prove one-way dependencies and no production/private or provider-specific boundary leak.
3. **Extract without behavior drift.**
   - Purpose: Lower review and regression radius while preserving the installed harness contract.
   - Changes: Move the selected flow family behind stable internal interfaces, keep compatibility exports, and avoid Task UI or provider-policy redesign.
   - Validation: Byte-normalized journals, artifact shapes, error codes, cleanup results, and public command behavior match the characterization baseline.
4. **Ratchet the result.**
   - Purpose: Prevent the hotspot from immediately regrowing.
   - Changes: Lower the file ceiling, register new module ownership, and create measured successor slices for other hotspots instead of expanding S15.
   - Validation: Quality gates reject new cycles, ceiling regression, clone growth, or unowned exclusions.

### Acceptance criteria

1. `flows.mjs` is below its approved S12 ceiling and owns fewer responsibilities.
2. Extracted modules have one-way boundaries and no provider-specific core leak.
3. Public commands, journals, artifact schemas, error taxonomy, cleanup, and safety effects are unchanged.
4. Other hotspots remain separately measured follow-ups rather than hidden S15 scope.
5. No `apps/web/**` or UI product-design file is changed.

### Done evidence

- flow characterization and before/after import maps
- byte-normalized journal/artifact parity report
- reduced file/complexity/clone metrics and ratchet update
- successor slice candidates for remaining measured hotspots
- `pnpm quality:ratchet`
- `pnpm slice:gate`

### Out of scope

- Step-execution, run-control, contract-loader, adapter-SDK, CLI-test, or web hotspot decomposition.
- Live-E2E behavior, profile, provider, or policy changes.
- Task Workspace and Command Desk code or fixtures.

## W71-S13 — Source-of-truth and story-evidence alignment

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-4, EPIC-5, EPIC-6, EPIC-7
- **Hard dependencies:** W71-S15
- **Remediation priority:** P1
- **Estimated effort:** M
- **Primary modules:** README, product/story docs, architecture/contracts,
  backlog/readiness, runbooks, examples and reference checks
- **Primary user story surfaces:** PBO-09, PBO-10, OPS-06, OPS-11, OPS-12,
  EMP-03, DEV-05, RMO-04, RMO-05, RMO-06, DTX-06, DTX-08, FIN-03

**Purpose:** Make current documentation and coverage claims derive from the
implemented central-AOR-Home flow and the actual strength of their evidence.

**Changes:** Remove current-state `.aor` drift, generate or semantically verify
roadmap/readiness counts, make indexes bidirectionally complete, define proof
tiers, and keep affected story statuses at their audited lower tier until S14
produces the installed integrated proof.

### Local tasks

1. **Align runtime-root guidance.**
   - Purpose: Prevent release and incident operators from preserving or restoring the wrong state.
   - Changes: Use `AOR_HOME/projects/<workspace-project-id>` consistently; retain repo-local `.aor` only for explicit portable config/export or labelled history.
   - Validation: Semantic reference checks reject current runbooks/examples that describe target-local mutable runtime state.
2. **Generate planning/readiness summaries.**
   - Purpose: Stop prose status and story counts from drifting from structured registries.
   - Changes: Generate or parse-check wave/slice state, story counts, latest wave, release blockers, and historical snapshot labels.
   - Validation: Deliberate state/count drift fails source-of-truth tests.
3. **Make indexes complete in both directions.**
   - Purpose: Ensure every public contract and operational runbook has an owner and index entry.
   - Changes: Register or relocate qualification-specific docs and validate all index-to-file and file-to-index mappings.
   - Validation: Adding an unindexed contract/runbook or dangling entry fails references.
4. **Hold story claims at audited evidence tiers.**
   - Purpose: Prevent implementation and fixture evidence from being promoted before installed integration proof exists.
   - Changes: Define unit, contract, fixture, mocked-browser, integrated-local, and live-provider tiers; retain the W71-S01 downgrades for affected W62/W70 stories and assign S14 as the proof-restoration owner.
   - Validation: No affected story returns to `proof-covered` from source regexes, screenshots, handcrafted refs, service-only tests, or route-fulfilled browser state.

### Acceptance criteria

1. Current docs and runbooks consistently use central AOR Home and label legacy behavior.
2. Roadmap, backlog, slice tooling, readiness, and story counts agree semantically.
3. Contract and runbook indexes are bidirectionally complete.
4. No story is proof-covered by source regexes, screenshots, handcrafted refs, or route-fulfilled browser state alone, and S13 does not restore any claim whose integrated proof is owned by S14.

### Done evidence

- central-AOR-Home documentation/reference diff
- generated or semantic backlog/readiness checks
- bidirectional contract/runbook index report
- updated story matrix with resolvable proof tiers
- `pnpm test:references`
- `pnpm slice:gate`

### Out of scope

- Rewriting labelled historical research artifacts.
- New product outcomes beyond the audited Task and multirepo flows.
- Live provider qualification.

## W71-S14 — UI-refactor integration, installed black-box closure, and freeze

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7
- **Hard dependencies:** W71-S13
- **External blocker:** `Улучшить UI и UX` must be merged to `main` or provide an explicit immutable handoff commit before S14 starts.
- **Remediation priority:** P0
- **Estimated effort:** L
- **Primary modules:** merged Command Desk/Task Workspace client integration,
  installed browser harness, package/install proof, freeze manifest and readiness
- **Primary user story surfaces:** PBO-09, PBO-10, DEV-05, DEV-06, OPS-01,
  OPS-06, OPS-11, OPS-12, RMO-04, RMO-05, RMO-06, DTX-01, DTX-04, DTX-08

**Purpose:** Integrate the sibling UI refactor with repaired runtime contracts
and prove the current packaged product through real control-plane journeys before
freezing inputs for W66-S09.

**Changes:** Merge-first from the UI handoff, reconcile only minimal client
wiring, remove AOR API fulfillment mocks from outcome acceptance, execute four
installed local scenarios, and freeze all source/target/profile/proof identities.

### Local tasks

1. **Synchronize the UI handoff.**
   - Purpose: Combine independent UI and runtime work without overwriting either branch.
   - Changes: Inspect the sibling task/PR, require its merge or immutable handoff, fetch `origin`, update from `origin/main`, compare changed paths, and reconcile Task contract/client wiring under one integration owner.
   - Validation: Final diff preserves the accepted Command Desk design, contains no conflict-marker or duplicated lifecycle implementation, and records both source commits.
2. **Run the no-write Task journey.**
   - Purpose: Prove the primary installed outcome through the actual local app and control plane.
   - Changes: From a neutral directory and isolated AOR Home, connect a disposable project, select the approved project-default route, apply a Task route override and write-back/safety mode, prove readiness, prepare inline plus pinned Markdown, start once, follow every server-published action, reload at Prepared/Active/Review/Completed, and create a follow-up.
   - Validation: Start is blocked for an unavailable/unready route; the accepted run uses exactly the displayed Task contract revision, route, and write-back mode; route selection survives reload; one durable lineage closes; target HEAD/status stay unchanged; repo-local `.aor` is absent; no raw credential/provider-specific bypass occurs; and no AOR API route is fulfilled by the browser test.
3. **Run patch/recovery/Ask AOR journeys.**
   - Purpose: Prove write-effect review and recovery without upstream effects.
   - Changes: Exercise bounded patch-only review/delivery plus stale revision, fail-once runner, Attention, Ask AOR create/run, retry, verification, completion, and immutable history.
   - Validation: Actual diff/check/request/attempt/delivery artifacts resolve after reload; duplicate actions remain idempotent; commit/push do not occur.
4. **Run public two-repository closure.**
   - Purpose: Restore the multirepo proof claims against production surfaces.
   - Changes: Execute provision, children, conflict serialization, retry, integration, aggregate checks, delivery evidence, and cleanup using installed public commands/API.
   - Validation: Source repos remain unchanged and every Task/unit/attempt/repo/diff/digest reference resolves.
5. **Restore evidence-backed story claims.**
   - Purpose: Promote only outcomes exercised by the merged installed product.
   - Changes: Re-evaluate OPS-11, OPS-12, PBO-10, and affected W62 multirepo stories against the immutable S14 journals; keep every incomplete outcome `partial` with an owning gap or `baseline-covered` without a proof claim.
   - Validation: Each promoted row resolves to the current source/package identity, real action journal, durable artifact bytes, before/after safety snapshot, and declared runner mode.
6. **Regenerate final-commit adversarial proof.**
   - Purpose: Prevent S11 evidence from being reused after quality, hotspot, documentation, or UI integration commits change source identity.
   - Changes: Rerun the complete W66 adversarial family proof and all shared evidence resolution/freshness checks against the final merged S14 source/package candidate.
   - Validation: `pnpm w66:proof` passes, every family/case/validator ID resolves to current immutable bytes, and all pre-final-commit proof is classified diagnostic-only.
7. **Freeze qualification inputs.**
   - Purpose: Ensure W66-S09 qualifies the same product accepted locally.
   - Changes: Record source and target commits, packaged version, UI handoff commit, profile hashes, proof hashes, artifact digests, environment, and residual exclusions.
   - Validation: `production:ready` is blocked only by the still-unrun fresh provider matrix and rejects any later identity drift.

### Acceptance criteria

1. The merged Command Desk UI renders only server-owned lifecycle, runner, safety, review, and completion truth.
2. Prepared UI outcome, acceptance, scope, route, readiness, write-back mode, and revision match the Task GET projection and the confirmed Start input, and the selected route remains identical after reload.
3. No-write, patch-only/recovery/Ask AOR, and two-repository installed scenarios pass without AOR API fulfillment mocks or upstream writes.
4. Desktop, mobile, 200% zoom, keyboard-only, reduced-motion, focus, offline/reconnect, overflow, and console-error checks pass on the merged UI.
5. Every evidence reference resolves after reload and matches immutable bytes, digest, owner identity, and the frozen commit.
6. Story claims are restored only to the strongest tier justified by the current installed journals.
7. The final integrated commit has a newly generated passing adversarial proof; no S11-era proof survives source drift as current evidence.
8. The qualification freeze is ready for a complete same-commit W66-S09 rerun; no earlier cell counts toward closure.

### Done evidence

- sibling UI task/PR handoff and merge-base record
- installed no-write, patch/recovery/Ask AOR, and two-repository action journals
- desktop/mobile/accessibility/browser evidence against the real control plane
- package/install/smoke reports and target before/after Git snapshots
- final-commit `pnpm w66:proof` output and current evidence digests
- immutable W66 qualification freeze manifest
- `pnpm check`
- `pnpm test:web:browser`
- `pnpm release:pack`
- `pnpm release:smoke`
- `pnpm production:ready --json`
- `pnpm slice:gate`

### Out of scope

- Additional Command Desk redesign after the accepted sibling UI handoff.
- Paid Codex/Claude execution, owned by W66-S09.
- General production clearance before all four required provider cells pass.

## Wave exit criteria

W71 is development-complete only when:

1. No open release-blocking filesystem, state-integrity, contract, Task-flow,
   multirepo, or evidence finding remains.
2. The sibling UI refactor is merged and the combined packaged UI passes real
   control-plane black-box acceptance without browser-owned lifecycle state.
3. Every W71 slice has focused evidence and a passing canonical slice gate.
4. Story/readiness claims match the strongest current evidence tier.
5. One immutable qualification freeze exists for W66-S09.

W71 completion does not itself close W66-S09. Release clearance still requires
all four required Codex/Claude cells to pass on the W71-S14 freeze.
