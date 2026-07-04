# W45 - bounded review and QA repair loop

W45 follows the W44 prompt/readiness wave and turns review and QA findings into
a bounded cross-stage repair loop instead of an implicit or unbounded agentic
cycle.

## Wave objective

Operators, reviewers, QA users, and delivery engineers should be able to see,
request, execute, and close a repair cycle from review or QA findings while AOR
preserves evidence lineage, compiled prompt/context inputs, explicit budgets,
and delivery/release blocking semantics.

## Wave exit criteria

- Review and QA repair requests share one contract with source gate, finding
  refs, repair scope, cycle attempt, budget, status, evidence refs, and
  downstream blocking semantics.
- The operating model defines the allowed state machine:
  `implement -> review -> repair -> review -> qa -> repair -> review -> qa`.
- Runtime and `next-action` surfaces never continue an unbounded loop; exhausted
  cycle budgets produce an operator-visible hold/blocker.
- Repair implementation steps receive the source repair request through compiled
  prompt/context lineage rather than ad hoc text injection.
- CLI/API/web surfaces show the active quality gate, open repair requests,
  attempt counts, next safe action, and the evidence needed for operator review.
- Deterministic fixtures and a live E2E acceptance profile cover at least one
  review-origin repair and one QA-origin repair through closure or budget
  exhaustion.
- A dedicated post-implementation closure slice refreshes source-of-truth docs
  and records passing live E2E acceptance evidence after implementation lands.

---

## W45-S01 — Quality repair request contract and operating model
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Define the contract-first semantics for bounded review/QA repair
  cycles before runtime behavior depends on them.
- **Primary modules:** `docs/contracts/**`, `docs/architecture/**`,
  `examples/reports/**`, `examples/project.aor.yaml`, `docs/backlog/**`
- **Hard dependencies:** W44-S05
- **Primary user story surfaces:** DEV-05, DEV-07, RQA-02, RQA-06, OPS-04.

### Local tasks
1. Add a `quality-repair-request` contract covering review and QA sources, finding refs, repair scope, cycle id, attempt budget, status, blockers, and evidence refs.
2. Update `review-decision`, QA/report, `step-result`, `runtime-harness-report`, and `next-action-report` contracts with additive repair lineage fields.
3. Update the orchestrator operating model to define the bounded quality repair state machine and explicit budget-exhaustion behavior.
4. Add sample reports for review-origin repair, QA-origin repair, and exhausted repair budget.
5. Add a `quality_repair_policy` example to the sample project profile.
6. Document how repair request refs enter compiled prompt/context inputs for the repair implementation step without leaking provider-specific behavior.

### Acceptance criteria
1. Contract docs and examples define one shared repair request artifact for review and QA findings.
2. The state machine requires review after any repair and QA after a passing post-repair review when QA is in scope.
3. Cycle budgets are policy-driven, not hardcoded in docs or examples.
4. Downstream delivery/release remains blocked while any required repair request is open, in progress, or exhausted without operator approval.
5. Existing `review-decision` semantics remain backward-compatible.

### Done evidence
- updated contract docs and sample reports
- updated operating-model section
- updated sample project profile policy
- contract/reference integrity checks or documented blocker
- `pnpm slice:plan -- W45-S02`

### Out of scope
- Implementing runtime state transitions.
- Adding new CLI/API/web commands.
- Running live E2E proof.

---

## W45-S02 — Cross-stage repair state machine and next-action resolver
- **Epic:** EPIC-4 Quality platform; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Make runtime and `next-action` resolve review/QA repair cycles
  through explicit bounded states.
- **Primary modules:** `packages/orchestrator-core/**`,
  `packages/observability/**`, `packages/contracts/**`, tests
- **Hard dependencies:** W45-S01
- **Primary user story surfaces:** DEV-05, EMP-07, RQA-05, RQA-06, OPS-01.

### Local tasks
1. Add core helpers to create, load, update, and close quality repair requests.
2. Extend run/flow closure state with `review-repair-requested`, `qa-repair-requested`, `repair-running`, `qa-required`, `repair-cycle-exhausted`, and `delivery-ready`.
3. Update `next-action` so review repair points to an implement repair run, QA repair points to implement repair then review, and budget exhaustion blocks.
4. Preserve repair lineage in step results, Runtime Harness reports, and compiled context refs for follow-up implementation steps.
5. Add tests for review-origin repair, QA-origin repair, successful closure, and exhausted cycle budgets.

### Acceptance criteria
1. A review `request-repair` creates or links a quality repair request and blocks delivery/release.
2. A QA failure can create or link a quality repair request and requires implement repair, review, then QA before delivery.
3. `next-action` returns one safe primary command for each repair state.
4. Exhausted repair budgets produce a hold/blocker, not another automatic run.
5. Runtime behavior remains runner-agnostic and does not branch on provider implementation details.

### Done evidence
- runtime unit tests for all repair states
- next-action fixture updates
- step-result and Runtime Harness lineage evidence
- `pnpm test`
- `pnpm slice:plan -- W45-S03`

### Out of scope
- Web UI rendering.
- Live E2E proof.
- Provider-specific adapter behavior.

---

## W45-S03 — CLI and control-plane quality repair surfaces
- **Epic:** EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Expose quality repair requests and decisions through public CLI
  and API surfaces without requiring raw artifact editing.
- **Primary modules:** `apps/cli/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/contracts/control-plane-api.md`,
  `examples/control-plane-api/**`, tests
- **Hard dependencies:** W45-S02
- **Primary user story surfaces:** DEV-05, RQA-02, OPS-04, OPS-10.

### Local tasks
1. Extend `review decide --decision request-repair` to create/link a quality repair request and print the next safe action.
2. Add CLI read/status coverage for open repair requests, cycle attempts, blockers, and evidence refs.
3. Add control-plane read/mutation payloads for quality repair requests and update the machine-readable API examples.
4. Enforce project/auth/write-mode boundaries for repair request mutations.
5. Add CLI/API tests for repair creation, status reads, invalid transitions, and exhausted-budget responses.

### Acceptance criteria
1. Operators can request or inspect repair from CLI/API without editing JSON.
2. API responses expose the same next-action state as the headless resolver.
3. Invalid repair transitions fail closed with readable error messages.
4. Auth and project scoping match existing production-hardened mutation rules.
5. Existing review approval and hold paths remain compatible.

### Done evidence
- CLI command test output
- API contract/example updates
- mutation/read-surface tests
- `pnpm test`
- `pnpm slice:plan -- W45-S04`

### Out of scope
- Web UI rendering.
- Live E2E proof.
- New delivery/release publication behavior.

---

## W45-S04 — Web repair-cycle observability
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Make repair cycles understandable in the local console through
  flow-scoped quality gate, evidence, and next-action views.
- **Primary modules:** `apps/web/**`, `apps/api/**`,
  `packages/orchestrator-core/**`, `docs/product/**`, tests
- **Hard dependencies:** W45-S03
- **Primary user story surfaces:** OPS-01, OPS-02, OPS-04, OPS-11, RQA-02.

### Local tasks
1. Add flow detail/read-model fields for active quality gate, repair request status, attempt budget, source stage, and blocking reason.
2. Render review-origin and QA-origin repair requests with finding refs, evidence summaries, and the recommended next action.
3. Show budget exhaustion as an operator-visible hold with explicit evidence rather than a silent failed loop.
4. Add web tests for review repair, QA repair, and exhausted cycle states.
5. Update product docs or UI screenshots only where the visible workflow changes.

### Acceptance criteria
1. A user can distinguish review repair, QA repair, and budget exhaustion from the flow cockpit without opening raw artifacts.
2. UI actions match the resolver's primary next action and do not offer unsafe delivery/release actions while repair is open.
3. Evidence refs remain flow-scoped and readable.
4. Completed flows stay read-only; follow-up repair work starts through runtime commands, not direct completed-flow mutation.

### Done evidence
- web test output
- browser or app smoke notes if UI changes
- updated product docs/screenshots if needed
- `pnpm web:build`
- `pnpm slice:plan -- W45-S05`

### Out of scope
- Redesigning the flow cockpit.
- Adding hosted/SaaS workflow state.
- Changing provider qualification policy.

---

## W45-S05 — Repair-loop proof fixtures and live profile
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Prepare replayable proof fixtures and a live E2E acceptance profile
  for bounded review/QA repair cycles.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`,
  `docs/ops/**`, tests
- **Hard dependencies:** W45-S02, W45-S03, W45-S04
- **Primary user story surfaces:** DEV-05, RQA-05, OPS-06, OPS-07, FIN-03.

### Local tasks
1. Add deterministic fixtures and a live E2E profile that demonstrate a review-origin repair cycle through closure.
2. Add deterministic fixtures and a live E2E profile that demonstrate a QA-origin repair cycle returning through review before QA closure.
3. Add a budget-exhaustion proof or fixture with operator-visible hold evidence.
4. Ensure the live E2E profile records repair request refs, implementation repair refs, review rerun refs, QA rerun refs, and no-upstream-write evidence.
5. Add targeted tests for the proof/profile assets and profile validation.
6. Leave the final docs refresh and actual post-implementation live E2E acceptance run to W45-S06.

### Acceptance criteria
1. Review-origin and QA-origin repair paths have replayable fixture/profile coverage.
2. QA-origin repair cannot skip post-repair review in proof fixtures or profile expectations.
3. Budget exhaustion is visible as hold/blocker evidence with no automatic unbounded rerun.
4. Proof/profile assets are ready for the mandatory W45-S06 live E2E acceptance run.
5. Deterministic tests cover the proof/profile shape before live execution.

### Done evidence
- repair-loop proof fixture refs
- live E2E profile refs
- targeted test output
- `pnpm test`
- `pnpm slice:plan -- W45-S06`

### Out of scope
- Publishing a new npm release.
- Final source-of-truth documentation refresh.
- The post-implementation live E2E acceptance run.

---

## W45-S06 — Documentation refresh and live E2E acceptance
- **Epic:** EPIC-7 Live E2E and rehearsal; EPIC-0 Repository development system
- **State:** blocked
- **Outcome:** After W45 implementation lands, update source-of-truth documentation
  and run live E2E acceptance proving the bounded review/QA repair loop is OK.
- **Primary modules:** `docs/architecture/**`, `docs/contracts/**`,
  `docs/ops/**`, `docs/product/**`, `docs/backlog/**`, `README.md`,
  `scripts/live-e2e/**`, `examples/live-e2e/**`, tests
- **Hard dependencies:** W45-S05
- **Primary user story surfaces:** DEV-05, DEV-07, RQA-02, RQA-05, RQA-06,
  OPS-04, OPS-06, OPS-07, FIN-03.

### Local tasks
1. Refresh architecture, contracts, product, ops, README, and backlog docs so they match the implemented W45 repair-loop behavior.
2. Run the required live E2E acceptance profile from a clean runtime after W45-S02 through W45-S05 are implemented.
3. Prove review-origin repair closure with live evidence refs for request, repair implementation, review rerun, QA handoff, and downstream unblock.
4. Prove QA-origin repair closure with live evidence refs for request, repair implementation, post-repair review, QA rerun, and downstream unblock.
5. Record provider, target, environment, runtime root, no-upstream-write state, run refs, report refs, and final pass/fail classification in the runbook or proof notes.
6. Fix any W45 regression found by live E2E or split it into explicit follow-up backlog; W45 cannot close as all-ok with failing required live E2E evidence.

### Acceptance criteria
1. Source-of-truth docs describe the implemented repair-loop semantics without stale planned-only wording for delivered behavior.
2. Required live E2E acceptance runs pass for review-origin and QA-origin repair paths after implementation.
3. QA-origin repair evidence proves the repair returns through review before QA closure.
4. Live E2E evidence proves the loop remains bounded and budget exhaustion cannot silently continue.
5. W45 closure cannot rely only on deterministic tests; passing live E2E run refs are required.

### Done evidence
- updated source-of-truth docs and runbooks
- live E2E acceptance command output and run refs
- review-origin and QA-origin repair evidence refs
- `pnpm slice:status`
- `pnpm slice:gate`

### Out of scope
- Publishing a new npm release.
- Certifying optional providers as release-blocking.
- Expanding beyond review/QA-origin repair loops.
