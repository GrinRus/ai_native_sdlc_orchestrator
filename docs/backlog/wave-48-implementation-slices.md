# W48 implementation slices

W48 turns the W47 control closure into a more realistic product-development
flow. Medium+ product-change live E2E now models a full implementation quality
cycle: `execution#N -> review#N -> qa#N`, with review-origin and QA-origin
public repair both returning to the next execution iteration.

## W48-S01 — Quality-cycle contract and profile policy
- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Require medium+ product-change profiles to declare QA as part of
  the implementation cycle and enumerate all supported repair sources.
- **Primary modules:** `docs/contracts/**`, `docs/ops/**`,
  `scripts/live-e2e/profiles/**`, `scripts/live-e2e/lib/profile-catalog.mjs`,
  tests
- **Hard dependencies:** W47-S04

### Local tasks
1. Document the quality-cycle policy and no-backward-compatibility profile shape.
2. Add profile resolver validation for `cycle_steps` and `repair_sources`.
3. Migrate active medium, large, and xlarge product-change profiles.
4. Preserve small canary flow-health behavior without a product QA cycle.

### Acceptance criteria
1. Medium+ product-change profiles without `qa` in `cycle_steps` are rejected.
2. Medium+ product-change profiles without review, QA, primary, and diagnostic
   repair sources are rejected.
3. Small flow-regression profiles remain valid without product QA cycle fields.
4. Docs identify QA as a first-class live E2E step.

### Done evidence
- profile resolver tests
- migrated YAML profiles
- contract and runner docs

### Out of scope
- weakening W46/W47 all-pass policy
- making xlarge required qualification coverage

## W48-S02 — Quality-cycle runner and controller implementation
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Execute public implementation iterations as
  `execution -> review -> qa`, with QA-origin blockers routed back through the
  public repair loop.
- **Primary modules:** `scripts/live-e2e/lib/flows.mjs`,
  `scripts/live-e2e/lib/step-controller.mjs`, `scripts/test/**`
- **Hard dependencies:** W48-S01

### Local tasks
1. Replace review-only looping with a review-plus-QA quality cycle.
2. Record iteration-specific `execution`, `review`, and `qa` journal evidence.
3. Block delivery until final review, QA, and verification evidence pass.
4. Classify exhausted review and QA repair separately.

### Acceptance criteria
1. Review failure skips QA and starts the next public execution iteration.
2. QA failure after passing review creates a public repair request.
3. Missing accepted `qa#N` step-quality evidence blocks continuation for
   medium+ product-change runs.
4. Delivery/release/learning run only after final review and QA pass.

### Done evidence
- runner source tests
- step-controller iteration lineage tests
- `pnpm live-e2e:test`

### Out of scope
- private runner patching of target repositories
- delivery/release/learning inside the repair iteration loop

## W48-S03 — Structured repair context and convergence classification
- **Epic:** EPIC-4 Quality platform; EPIC-6 Operator surface; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make every public `request-repair` decision carry structured
  context that identifies the source phase, iteration, unresolved findings,
  verification evidence, previous repair lineage, stop reason, and next step.
- **Primary modules:** `docs/contracts/review-decision.md`,
  `packages/contracts/**`, `packages/observability/**`,
  `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W48-S02

### Local tasks
1. Extend `review-decision` with required `repair_context`.
2. Add `--repair-context-file` to public `aor review decide`.
3. Materialize structured repair context from the live E2E runner.
4. Preserve separate blocker classes for review, QA, and post-run verification.

### Acceptance criteria
1. `request-repair` without structured source, iteration, findings, evidence,
   stop reason, and `requested_next_step=execution` is rejected.
2. Approve and hold decisions still carry neutral `repair_context`.
3. CLI output exposes `review_decision_repair_context`.
4. Repeated repair attempts have explicit previous decision refs and findings.

### Done evidence
- contract loader tests
- CLI tests
- observability contract validation

### Out of scope
- bypassing public review/repair lifecycle commands
- accepting identical non-actionable repeated repair as product acceptance

## W48-S04 — Vitest target toolchain policy
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make the Vitest large proof fail before product execution when
  the target Node toolchain is incompatible, and allow an explicit compatible
  Node binary override.
- **Primary modules:** `scripts/live-e2e/lib/target-materialization.mjs`,
  `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml`,
  tests
- **Hard dependencies:** W48-S03

### Local tasks
1. Add `target_toolchain.node.required_range` to the Vitest profile.
2. Support `AOR_LIVE_E2E_TARGET_NODE_BIN` in setup and verification commands.
3. Keep verification isolated from `.aor/` runtime state.
4. Keep missing build artifacts classified as setup/environment blockers.

### Acceptance criteria
1. Host Node incompatibility blocks before product execution.
2. A configured target Node override is first on `PATH` for target commands.
3. The old `.aor` scan and missing `dist/cli.js` W46 blockers do not recur as
   product-quality failures.
4. Changed-path evidence still comes from the canonical target checkout root.

### Done evidence
- generated Vitest profile tests
- target materialization tests
- profile docs

### Out of scope
- treating toolchain blockers as product acceptance
- provisioning every possible hard-target runtime automatically

## W48-S05 — Control quality-cycle proof rerun and product acceptance closure
- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Backlog reconciliation:** This W48-specific proof rerun is closed as a
  superseded backlog record. W49 and W50 provide stricter successor proof
  evidence, and no W48-only product acceptance is claimed.
- **Outcome:** Reconcile the historical W48 control-proof gap against W49/W50
  successor evidence so W48 no longer appears as current open work.
- **Primary modules:** `scripts/live-e2e/**`, `scripts/live-e2e/docs/runbooks/live-e2e-proof-complete-findings.md`, root checks, live proof runs
- **Hard dependencies:** W48-S04

### Local tasks
1. Preserve W48 implementation validation without claiming W48-only product acceptance.
2. Link W49/W50 successor proof runs as the terminal control proof evidence for the quality-cycle lane.
3. Record that W48-S05 has no downstream hard-dependency consumers and W49 intentionally starts from W48-S04.
4. Update backlog, roadmap, and proof findings so W48-S05 no longer appears as current open work.
5. Keep `.aor/` runtime artifacts uncommitted.

### Acceptance criteria
1. Master backlog and owning wave doc mark W48-S05 done as superseded reconciliation, not W48-only product acceptance.
2. Proof findings state that W49/W50 successor evidence owns terminal control proof closure for this lane.
3. Roadmap and dependency notes no longer advertise W48-S05 as current open proof work.
4. `pnpm slice:status` no longer reports W48-S05 as an open blocker.
5. `.aor/` runtime artifacts remain uncommitted.

### Done evidence
- W49/W50 successor proof findings with run ids and product-acceptance limits
- updated backlog, roadmap, and dependency notes
- `pnpm slice:status`
- `pnpm slice:sync-ready`
- `pnpm check`

### Out of scope
- claiming W48-only product acceptance
- rerunning historical W48 profiles after successor proof closure
- making optional xlarge proof required
