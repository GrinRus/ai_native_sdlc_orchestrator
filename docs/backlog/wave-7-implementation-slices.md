# W7 implementation slices

## Wave objective
Close remaining MVP+ governance and quality stories across certification controls, finance evidence, and learning-loop recertification.

## Wave exit criteria
- governance-focused quality checks and audit evidence share one deterministic runtime path
- AI platform promotion/freeze decisions have stronger baseline-comparison and regression controls
- incident recertification and re-enable flow is documented, runnable, and evidence-linked
- finance evidence surfaces are durable and queryable in operator workflows
- wave-level integration proves coherent closure of all W7 story mappings

## Parallel start and sequencing notes
- `W7-S01` establishes shared governance evidence semantics for the rest of the wave.
- `W7-S03` and `W7-S04` can run in parallel after `W6-S06`.
- `W7-S05` is the integration closer and should land after the other W7 slices.

---

## W7-S01 — Governance quality guardrails and evidence parity
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Expand quality governance checks so deterministic validation, eval evidence, and finance signals stay consistent.
- **Primary modules:** `packages/orchestrator-core`, `packages/harness`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W6-S03, W3-S04
- **Primary user-story surfaces:** architect / tech lead, reviewer / QA, finance / audit / hygiene

### Local tasks
1. Extend governance checks linking deterministic validation and eval/harness evidence.
2. Add finance-oriented evidence fields where governance decisions require cost/latency context.
3. Update quality docs to define guardrail semantics and failure modes.
4. Add tests covering guardrail pass/hold/fail decisions.

### Acceptance criteria
1. Governance checks can compare deterministic and evaluative evidence in one path.
2. Finance-relevant evidence required by policy is present in governance decisions.
3. Failure/hold semantics are documented and reproducible.
4. Tests cover regression, missing-evidence, and policy-blocked scenarios.

### Done evidence
- governance quality test fixtures
- updated quality policy docs and contract examples
- command/API transcript showing blocked and approved flows

### Out of scope
- incident recertification controls
- later-stage productization requirements

---

## W7-S02 — AI platform promotion/freeze maturity pack
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Strengthen promotion and freeze decisions with baseline comparison and controlled rollout semantics.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W7-S01, W3-S05
- **Primary user-story surfaces:** AI platform owner, finance / audit / hygiene

### Local tasks
1. Add baseline-comparison evidence requirements for promotion and freeze decisions.
2. Align promotion/freeze decision outputs with updated governance guardrails.
3. Extend docs and command semantics for AI platform owner workflows.
4. Add tests for candidate/stable comparisons and freeze escalation paths.

### Acceptance criteria
1. Promotion/freeze decisions require explicit baseline-comparison evidence.
2. Decision outputs include all fields needed for audit and rollout traceability.
3. Command/help/docs semantics match runtime decision behavior.
4. Tests cover promote, hold, fail, and freeze edge cases.

### Done evidence
- promotion/freeze decision fixtures with baseline links
- updated command/contract docs for AI platform maturity
- automated tests for comparison and freeze paths

### Out of scope
- later-wave incident correlations
- UI-specific visualization redesign

---

## W7-S03 — Incident recertification and controlled re-enable flow
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add a controlled incident recertification path before re-enabling problematic routes and assets.
- **Primary modules:** `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W7-S02, W6-S06
- **Primary user-story surfaces:** incident / improvement owner

### Local tasks
1. Define incident-state transitions for recertify, hold, and re-enable decisions.
2. Link incident status transitions to certification evidence and run traces.
3. Extend incident runbooks and command docs with recertification flow.
4. Add tests for re-enable gating and blocked recertification scenarios.

### Acceptance criteria
1. Incident recertification flow is runnable and prevents unverified re-enable.
2. Incident transitions are linked to certification evidence roots.
3. Ops docs define when re-enable is allowed versus blocked.
4. Tests cover approved and rejected recertification paths.

### Done evidence
- incident recertification fixtures and state-transition tests
- updated incident runbook with re-enable checklist
- command/API transcripts for recertify/re-enable flow

### Out of scope
- automated incident triage prioritization
- later-wave analytics dashboards

---

## W7-S04 — Finance evidence and audit durability expansion
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Expand finance/audit durability so operator-visible evidence supports cross-run governance reviews.
- **Primary modules:** `packages/observability`, `apps/api`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S06
- **Primary user-story surfaces:** finance / audit / hygiene

### Local tasks
1. Expand durable finance evidence surfaces for route/wrapper/adapter cost and latency insights.
2. Align audit read outputs with the new finance evidence fields.
3. Document audit review workflow for recurring governance checks.
4. Add tests for finance evidence aggregation and audit retrieval.

### Acceptance criteria
1. Finance evidence is queryable in durable audit surfaces.
2. Evidence fields align with policy and governance needs.
3. Audit docs define repeatable review workflows.
4. Tests validate finance evidence completeness and retrieval integrity.

### Done evidence
- audit/finance fixtures for multiple run profiles
- API/CLI tests for finance evidence retrieval
- ops doc updates for audit hygiene workflow

### Out of scope
- billing or chargeback automation
- later-wave executive dashboards

---

## W7-S05 — MVP+ governance and learning-loop integration closure
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Close W7 as a coherent governance wave by integrating quality, incident, and finance evidence into a repeatable learning loop.
- **Primary modules:** `docs/backlog/**`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`
- **Hard dependencies:** W7-S02, W7-S03, W7-S04
- **Primary user-story surfaces:** architect / tech lead, AI platform owner, finance / audit / hygiene, incident / improvement owner

### Local tasks
1. Add a W7 integration rehearsal path that exercises governance, incident, and finance evidence together.
2. Update backlog handoff guidance with explicit W7 completion evidence expectations.
3. Align live-e2e examples and runbooks with W7 governance semantics.
4. Add wave-level smoke verification covering the integrated flow.

### Acceptance criteria
1. Integrated W7 rehearsal produces linked quality, incident, and finance evidence.
2. Backlog and ops docs describe repeatable wave-level closure checks.
3. Example profiles remain aligned with integrated governance behavior.
4. Smoke verification passes and leaves durable artifacts.

### Done evidence
- W7 integration rehearsal transcript
- linked quality/incident/finance artifact bundle
- updated backlog and ops closure notes

### Closure rehearsal references
- profile: `scripts/live-e2e/profiles/w7-governance-integration.yaml`
- runbook: `docs/ops/live-e2e-w7-governance-closure.md`
- fixture bundle: `examples/live-e2e/fixtures/w7-s05/w7-governance-artifact-bundle.sample.json`

### Out of scope
- later-wave strategy reporting
- non-local external environment automation
