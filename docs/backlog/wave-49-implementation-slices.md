# W49 implementation slices

W49 closes the W48 proof gap by hardening quality-cycle evidence before any new
product acceptance claim. It keeps W46/W47 all-pass policy intact: blocked proof
runs are useful terminal evidence, but they are not product-quality acceptance.
W49 is the stricter successor proof wave for W48-S05 and does not require
marking the W48-specific control proof rerun as accepted.

## W49-S01 — Proof findings hygiene and evidence truthfulness
- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Keep committed findings aligned with actual proof evidence and
  remove stale all-pass claims when run ids, summaries, quality reports, and
  gates are not present.
- **Primary modules:** `docs/ops/live-e2e-proof-complete-findings.md`,
  `docs/backlog/**`
- **Hard dependencies:** W48-S04

### Local tasks
1. Audit W48 proof findings for claims without run ids and gate artifacts.
2. Mark pending proof work explicitly instead of reporting local checks as live
   proof acceptance.
3. Add W49 proof closure rows and ticket mapping.

### Acceptance criteria
1. Findings distinguish local regression gates from live proof runs.
2. Blocked/pending proof rows do not claim product acceptance.
3. W49 proof outcomes have a place to record owner, phase, class, and next
   ticket.

### Done evidence
- findings doc update
- backlog consistency checks

### Out of scope
- committing `.aor/` runtime state

## W49-S02 — Repeated repair anti-loop enforcement
- **Epic:** EPIC-4 Quality platform; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Prevent repeated public repair attempts that carry the same
  unresolved context and no new actionable evidence.
- **Primary modules:** `docs/contracts/review-decision.md`,
  `packages/contracts/**`, `packages/observability/**`,
  `scripts/live-e2e/lib/flows.mjs`, tests
- **Hard dependencies:** W49-S01

### Local tasks
1. Add `context_fingerprint` and `new_context_since_previous` to
   `repair_context`.
2. Validate repeated repair decisions fail closed without new context.
3. Compare current and previous repair contexts before issuing another public
   `request-repair`.
4. Classify repeated non-actionable repair as
   `repeated_repair_context_without_new_evidence`.

### Acceptance criteria
1. Raw `request-repair` artifacts without a fingerprint are rejected.
2. Repeated repair artifacts with previous repair refs and empty new context are
   rejected.
3. Runner stops before another repair command when the fingerprint repeats with
   no new evidence.
4. Run-health preserves the blocker owner, phase, class, and repair context
   fingerprint.

### Done evidence
- contract loader tests
- runner/source tests
- `pnpm live-e2e:test`

### Out of scope
- weakening repair budgets or bypassing public AOR review/repair commands

## W49-S03 — QA-specific step-quality evaluator hardening
- **Epic:** EPIC-4 Quality platform; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make `qa#N` a product-quality gate with QA-specific dimensions,
  not just generic flow-health evidence.
- **Primary modules:** `docs/contracts/live-e2e-step-quality-assessment-*.md`,
  `packages/contracts/**`, `scripts/live-e2e/lib/step-quality-assessment.mjs`,
  `scripts/live-e2e/lib/flows.mjs`, tests
- **Hard dependencies:** W49-S02

### Local tasks
1. Require QA requests to include `quality_cycle_context`.
2. Require accepted QA reports to evaluate `verification_relevance`,
   `regression_signal_quality`, `mission_relevance`, and `repair_necessity`.
3. Include eval, diagnostic verification, review, changed-path, and repair
   lineage evidence in QA evaluator inputs.
4. Preserve small canary lightweight flow-health behavior.

### Acceptance criteria
1. Accepted medium+ product-change `qa` report without QA dimensions is rejected.
2. QA request without `quality_cycle_context` is rejected.
3. Delivery remains blocked without accepted linked `qa#N` step-quality evidence.
4. Small flow-regression profiles remain valid without QA product gate.

### Done evidence
- contract loader tests
- step-controller tests
- runner/source tests

### Out of scope
- using private target mutations or private handoff rewrites as QA repair input

## W49-S04 — Full Control live E2E rerun and product acceptance closure
- **Epic:** EPIC-0 Repository development system; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Run the W49 Full Control proof set and claim product acceptance
  only for final all-pass gates.
- **Primary modules:** `scripts/live-e2e/**`,
  `docs/ops/live-e2e-proof-complete-findings.md`, root checks, live proof runs
- **Hard dependencies:** W49-S03

### Local tasks
1. Run same-commit `installed-user-guided-journey.yaml`.
2. Rerun `full-journey-regress-httpx-medium-openai.yaml`.
3. Prepare, validate, and gate paired HTTPX final quality assessment.
4. Rerun `full-journey-repair-fastify-medium-openai.yaml`.
5. Rerun `full-journey-regress-vitest-large-openai.yaml` with
   `AOR_LIVE_E2E_TARGET_NODE_BIN` when available.
6. Record run ids, statuses, owner/phase/class, all-pass result, accepted
   findings, and next ticket.

### Acceptance criteria
1. `guided-aor-ui` has run-health pass and accessibility/UI evidence.
2. `httpx-medium` is accepted only after final `gate --policy all-pass`.
3. `fastify-repair-medium` all-passes or records a precise non-W48 blocker with
   public repair lineage.
4. `vitest-large` all-passes under compatible Node or blocks before product
   execution as environment/target setup.
5. `.aor/` runtime artifacts remain uncommitted.

### Done evidence
- live proof run summaries
- quality assessment validate/gate outputs
- committed findings doc update
- `pnpm slice:gate`

### Out of scope
- making optional xlarge proof required
