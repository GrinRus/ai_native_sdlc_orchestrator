# W64 - post-audit release and service-boundary hardening

W64 turns the post-audit release-transaction finding and the remaining
service-boundary hotspots into three independently acceptable hardening
outcomes. It does not reopen the W59 audit closure, add product scope, or
publish a release as part of backlog maintenance.

Every W64 slice is blocked on W59-S07. After W59 closes, W64 can execute in
parallel with W60-W63 and the later W65 cutover, and its three slices can
execute in parallel with one another. W60-W63/W65 are not hard dependencies for
W64; implementations must preserve their contract, runtime, and
operator-surface compatibility. W65 likewise does not depend on W64 and must
sequence any shared projection change explicitly so W64 remains
behavior-preserving.

## Wave objective

Maintainers can safely resume an interrupted npm alpha publication, while the
verification, delivery, next-action, run-read, and certification trust
boundaries are decomposed into focused services without changing observable
behavior.

## Wave exit criteria

- Alpha publication reconciles npm, git tag, GitHub Release, and `alpha`
  dist-tag state through an explicit idempotent state machine.
- Partial publication can resume safely, conflicts fail before mutation, and
  the release branch is deleted only after the complete state is verified.
- Verification and delivery transaction boundaries preserve no-write,
  exact-diff, failure, and rollback semantics under characterization tests.
- Operator decision projections preserve action, blocker, ordering, isolation,
  pagination, and certification behavior under deterministic golden fixtures.
- Extracted services comply with the W59 quality ratchet and do not introduce
  new public contracts, transport coupling, or provider-specific core logic.

---

## W64-S01 — Idempotent alpha publish transaction and partial-failure recovery

- **Epic:** EPIC-0 Repository development system; EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Alpha publication detects exact remote state, conditionally
  converges compatible partial state to one complete release, and fails closed
  on conflicts without deleting recovery context.
- **Delivery priority:** P1
- **Estimated effort:** M
- **Primary modules:** `.github/workflows/release-publish.yml`,
  `scripts/release-event-guard.mjs`, `scripts/release-lib.mjs`, release-flow
  tests, `docs/ops/npm-cli-alpha-release.md`
- **Hard dependencies:** W29-S01, W59-S07
- **Primary user story surfaces:** DTX-07, OPS-06, FIN-03.

### Local tasks

1. **Define the alpha publication reconciliation state machine.**
   - Purpose: replace one-shot workflow assumptions with explicit recovery
     semantics for every externally visible publication state.
   - Changes: define `absent`, `npm-only`, `tag-only`, `release-only`,
     `complete`, and `conflict` from the expected package version, merge commit,
     release metadata, and channel state; define allowed transitions and terminal
     results.
   - Validation: table-driven fixtures classify every state and representative
     mixed state deterministically, with all incompatible combinations classified
     as `conflict`.
2. **Inspect exact remote identity before mutation.**
   - Purpose: distinguish a safely reusable artifact from a same-name artifact
     that points at different code or channel metadata.
   - Changes: inspect the remote git tag target, GitHub Release target and
     prerelease metadata, npm package version, and npm `alpha` dist-tag; retain
     the existing label, base, head-repository, branch/version, and OIDC guards.
   - Validation: mismatched tag SHA, package version, Release target/metadata, or
     dist-tag is reported before any mutating command is selected.
3. **Make publication steps conditional and idempotent.**
   - Purpose: converge compatible partial state while minimizing irreversible
     operations and never attempting to overwrite immutable npm versions.
   - Changes: reuse exact existing tag, Release, or npm state; create only the
     missing compatible surfaces; verify the complete state after each operation;
     delete the release branch only after complete-state reconciliation succeeds.
   - Validation: fresh and partial-state plans contain only required mutations,
     repeated complete-state execution is a no-op, and branch deletion is absent
     from every non-complete plan.
4. **Exercise failure injection and rerun convergence.**
   - Purpose: prove recovery at each irreversible boundary without touching the
     real registry or upstream repository.
   - Changes: inject failure after tag publication, GitHub Release publication,
     npm publication, and dist-tag reconciliation; build rerun matrices with
     mocks and local bare git remotes.
   - Validation: reruns from npm-only, tag-only, release-only, and later partial
     states converge once to `complete`, while injected conflicts stop before
     further mutation and retain the release branch.
5. **Separate partial-failure recovery from bad-release rollback.**
   - Purpose: give maintainers a resume/escalation path for an incomplete
     transaction without conflating it with remediation of a fully published bad
     immutable version.
   - Changes: add state inspection, safe resume, conflict escalation, retained
     branch, and evidence-capture instructions to the alpha runbook; keep the
     next-version/deprecation bad-release procedure as a distinct section.
   - Validation: runbook scenarios identify the state, allowed next operation,
     stop condition, escalation evidence, and whether branch deletion is safe.

### Acceptance criteria

1. Fresh state produces exactly one matching npm version, git tag target,
   GitHub prerelease target/metadata, and npm `alpha` dist-tag.
2. A rerun after npm-only, tag-only, or release-only partial failure converges to
   the same complete set without duplicate publication.
3. Exact existing remote artifacts are reused rather than recreated or treated
   as success without identity verification.
4. A mismatched tag SHA, package version, GitHub Release target/metadata, or
   `alpha` dist-tag fails before any mutation.
5. The release branch survives every partial or conflict state and is deleted
   only after the complete state is verified.
6. Existing label, base branch, same-repository head, branch/version, Trusted
   Publishing, and OIDC guards remain enforced with no token fallback.
7. Failure-injection and rerun tests perform no real registry or upstream
   repository writes.

### Done evidence

- publish-state model and reconciliation tests
- exact remote identity inspection and conflict fixtures
- conditional workflow plan and partial-state rerun matrix
- local bare-remote and mocked-registry failure-injection results
- separate resume/escalation and bad-release rollback runbook sections

### Out of scope

- Publishing an npm or GitHub release while implementing the slice.
- Moving `latest`, adding a stable channel, or overwriting an npm version.
- npm token fallback, alternate registries, Docker/GHCR, or hosted distribution.
- Automatically deleting conflicting remote artifacts.

---

## W64-S02 — Verification-to-delivery transaction decomposition

- **Epic:** EPIC-0 Repository development system; EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Project verification and delivery orchestration are split into
  focused transaction services while preserving exact verification, no-write,
  diff, delivery, failure, and rollback behavior.
- **Delivery priority:** P2
- **Estimated effort:** L
- **Primary modules:** `packages/orchestrator-core/src/project-verify.mjs`,
  `packages/orchestrator-core/src/delivery-plan.mjs`,
  `packages/orchestrator-core/src/delivery-driver.mjs`,
  `packages/orchestrator-core/src/delivery-mode-runners.mjs`, CLI/API adapters,
  focused core and integration tests
- **Hard dependencies:** W59-S07
- **Primary user story surfaces:** DEV-06, DTX-01, DTX-02, DTX-03, DTX-04.

### Local tasks

1. **Freeze verification-to-delivery behavior with characterization tests.**
   - Purpose: establish a reviewable behavioral boundary before moving logic
     between modules.
   - Changes: capture verification planning and command results, baseline
     comparison, delivery-plan materialization, exact changed-path/diff evidence,
     fork-first state transitions, no-write defaults, failures, and rollback.
   - Validation: deterministic fixtures cover pass, blocked, baseline-accepted,
     command failure, dirty workspace, stale diff, delivery failure, and rollback
     without changing current public output.
2. **Split `verifyProjectRuntime` into focused verification services.**
   - Purpose: separate input resolution, command execution, baseline comparison,
     evidence aggregation, and report persistence from the public coordinator.
   - Changes: introduce explicit service inputs/outputs and keep policy,
     subprocess, filesystem, and persistence effects behind narrow boundaries;
     retain `verifyProjectRuntime` as a bounded compatibility coordinator.
   - Validation: existing project-verification, archetype, live-E2E-boundary,
     CLI, and package tests produce equivalent decisions and evidence.
3. **Split `materializeDeliveryPlan` by deterministic planning responsibility.**
   - Purpose: make scope resolution, changed-path classification, exact diff,
     safety gates, and plan/report assembly independently testable.
   - Changes: extract pure planning and validation services without widening
     authorized paths, normalizing away meaningful diff data, or adding writes.
   - Validation: before/after golden fixtures preserve plan status, blockers,
     commands, path groups, exact diff evidence, and no-upstream-write defaults.
4. **Split `runDeliveryDriver` and the fork-first transaction path.**
   - Purpose: isolate preconditions, delivery-mode execution, evidence commit,
     cleanup, and rollback so partial failure cannot be mistaken for success.
   - Changes: decompose `runDeliveryDriver` and
     `runForkFirstPrDeliveryMode` into explicit transaction stages with owned
     side effects, failure results, and rollback/retained-evidence rules.
   - Validation: failure injection at each stage preserves the prior valid state,
     records the failed boundary, performs only authorized cleanup, and never
     reports delivery success after partial application.
5. **Enforce module boundaries and the quality ratchet.**
   - Purpose: prevent the compatibility coordinators or extracted files from
     becoming replacement monoliths.
   - Changes: add import-boundary checks, focused service tests, before/after
     complexity metrics, and CLI/API/package integration coverage.
   - Validation: the named coordinators meet the W59 complexity, depth, and
     physical-line ceilings; root and installed-package gates preserve supported
     behavior with no new cycle or transport dependency.

### Acceptance criteria

1. Public CLI/API commands, report/packet shapes, exit behavior, and supported
   verification and delivery modes remain compatible.
2. Characterization and golden fixtures preserve no-write defaults, authorized
   path scope, exact changed-path/diff evidence, baseline comparison, blockers,
   and delivery decisions.
3. Failure at any fork-first or delivery transaction stage leaves either the
   prior valid state or explicit retained recovery evidence and never a false
   success; rollback performs no unapproved upstream write.
4. Verification, planning, execution, persistence, cleanup, and rollback have
   explicit service boundaries with focused tests and no transport imports.
5. `verifyProjectRuntime`, `materializeDeliveryPlan`, `runDeliveryDriver`, and
   `runForkFirstPrDeliveryMode` each finish at complexity 19 or lower, nesting
   depth 4 or lower, and 100 physical lines or fewer; extracted production files
   stay at or below 1,000 physical lines.
6. Root, package, CLI/API integration, delivery, and rollback tests pass without
   committed `.aor/` state.

### Done evidence

- verification-to-delivery characterization matrix
- extracted service and side-effect ownership map
- exact-diff/no-write golden fixture results
- fork-first failure-injection and rollback results
- before/after complexity, dependency, and package-gate reports

### Out of scope

- New verification commands, delivery modes, or public contract fields.
- W62 multirepo scheduling, integration, or aggregate delivery behavior.
- Automatic upstream writes or weaker delivery authorization.
- Replacing the runner, Git, or process execution platform.

---

## W64-S03 — Operator decision projection decomposition

- **Epic:** EPIC-0 Repository development system; EPIC-4 Quality platform;
  EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Next-action, run-read, and certification decisions are produced
  by focused deterministic projections whose observable results remain fixed by
  golden fixtures.
- **Delivery priority:** P2
- **Estimated effort:** L
- **Primary modules:** `packages/orchestrator-core/src/next-action.mjs`,
  `packages/orchestrator-core/src/control-plane/read-run-projections.mjs`,
  `packages/orchestrator-core/src/certification-decision.mjs`, operator-request
  and control-plane adapters, focused core/API/CLI/web tests
- **Hard dependencies:** W59-S07
- **Primary user story surfaces:** ARC-04, DEV-05, OPS-01, OPS-04.

### Local tasks

1. **Create the operator-decision golden fixture matrix.**
   - Purpose: preserve current recommendations and read models before extracting
     projection logic.
   - Changes: capture lifecycle stages, incomplete/blocked/repair states, active
     and terminal runs, stale evidence, delivery readiness, certification pass
     and block, pagination, project isolation, and unknown references.
   - Validation: normalized goldens record action IDs, enabled state, commands,
     reasons, blocker codes, evidence refs, ordering, cursors, and certification
     decisions without unstable timestamps or temporary paths.
2. **Extract closure and artifact-readiness projections.**
   - Purpose: separate `buildClosureState` and `buildArtifactReadiness` from
     filesystem discovery, lifecycle coordination, and presentation assembly.
   - Changes: move closure prerequisites, artifact freshness, verification,
     review, delivery, release, and learning evidence into pure projections with
     explicit typed inputs and deterministic outputs.
   - Validation: unit fixtures cover missing, stale, conflicting, blocked, ready,
     and complete evidence and match the pre-extraction golden results.
3. **Reduce `resolveNextAction` to a bounded decision coordinator.**
   - Purpose: make evidence collection, lifecycle classification, blocker
     selection, safe-action policy, and report assembly independently reviewable.
   - Changes: extract focused selectors and policy functions while retaining one
     safe primary action, stable command surfaces, explicit blockers, runtime-root
     handling, and compatibility report assembly.
   - Validation: the full next-action suite and API/CLI/operator-request fixtures
     preserve action precedence, reasons, commands, evidence refs, and fail-closed
     behavior for incomplete evidence.
4. **Split `listRuns` into isolated read-projection services.**
   - Purpose: prevent discovery, project/runtime filtering, health/status
     projection, sorting, and pagination from sharing one stateful read function.
   - Changes: extract bounded readers and pure projections with explicit project,
     flow, runtime-root, filter, sort, cursor, and limit inputs.
   - Validation: API/control-plane goldens preserve isolation, ordering,
     pagination, partial/unknown evidence handling, and non-materializing reads.
5. **Split `certifyAssetPromotion` by validation and decision responsibility.**
   - Purpose: keep deterministic validation ahead of evaluation and make
     evidence aggregation, policy checks, scoring inputs, decision projection,
     and persistence independently testable.
   - Changes: introduce focused services with explicit evidence ownership and a
     bounded compatibility coordinator; do not allow evaluator output to bypass
     missing deterministic prerequisites or open blockers.
   - Validation: certification goldens preserve pass/block outcomes, findings,
     evidence refs, scores, promotion state, and no-write behavior across missing,
     invalid, stale, failed, and passing inputs.
6. **Enforce projection boundaries and the quality ratchet.**
   - Purpose: keep extracted decision services pure, transport-neutral, and
     smaller than the hotspots they replace.
   - Changes: add import/effect guards, focused unit coverage, integration
     compatibility checks, and before/after complexity metrics.
   - Validation: named functions meet W59 ceilings, no projection imports a
     transport, and CLI/API/web consumers pass against unchanged public results.

### Acceptance criteria

1. Golden fixtures preserve current action IDs, priority, enabled state,
   commands, reasons, blocker codes, evidence refs, certification findings, and
   decisions for every characterized state.
2. `resolveNextAction` still exposes exactly one safe primary recommendation and
   fails closed when required evidence is absent, stale, invalid, or conflicting.
3. `listRuns` preserves project/flow/runtime isolation, non-materializing reads,
   ordering, filtering, pagination, cursors, and partial-evidence behavior.
4. Certification still performs deterministic validation before any evaluator,
   cannot promote with missing prerequisites or open blockers, and preserves
   evidence-derived promotion truth.
5. `buildClosureState`, `buildArtifactReadiness`, `resolveNextAction`, `listRuns`,
   and `certifyAssetPromotion` each finish at complexity 19 or lower, nesting
   depth 4 or lower, and 100 physical lines or fewer; extracted production files
   stay at or below 1,000 physical lines.
6. No new public packet/report fields, routes, UI-owned lifecycle state, or
   transport-specific core dependencies are introduced.

### Done evidence

- normalized operator-decision golden fixture matrix
- closure/readiness, next-action, run-read, and certification service map
- focused projection, isolation, pagination, and fail-closed tests
- before/after complexity and import-boundary report
- CLI/API/web compatibility and root gate results

### Out of scope

- New recommendation policy, lifecycle stage, certification rule, or UI flow.
- W63 information architecture, visual design, or operator-workbench redesign.
- New evaluator/provider behavior or judge-based replacement for validation.
- Mutating run state from read projections.
