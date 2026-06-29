# W46 - complex product live E2E black-box assessment

W46 turns live E2E from flow smoke evidence into a product-quality assessment
system for AOR as an installed-user product.

## Wave objective

Operators should be able to run AOR against curated public repositories through
public CLI/API/UI surfaces, watch each SDLC step assessed from public evidence,
repair quality gaps only through AOR's public review/repair loop, and accept
medium+ runs only when the final target diff passes independent product-quality
assessment.

## Wave exit criteria

- Small missions are flow-regression canaries only.
- Medium, large, and xlarge missions are product-change missions with
  agent-visible requests and runner-only evaluator/final-code rubrics.
- The target catalog rejects legacy `xl`, raw repo/objective profiles, and
  generated matrix cells.
- Step-quality assessment requests/reports are contract-valid, linked, and
  required before medium+ continuation.
- Final all-pass quality is mandatory for medium+ product acceptance.
- Current target catalog cells are migrated or removed, and hard targets are
  introduced with runnable profiles.

## Backlog reconciliation note

PR #90 delivered W46-S01 through W46-S05 as part of the black-box product live
E2E implementation. W44/W45 remain an open prompt/readiness and repair-loop
planning track, but they are not hard blockers for W46-W52 live E2E proof
closure.

---

## W46-S01 — Contract/docs breaking policy
- **Epic:** EPIC-0 Foundation; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Define the breaking live E2E policy for mission class, size
  budgets, public-only black-box boundaries, and final product acceptance.
- **Primary modules:** `docs/contracts/**`, `docs/ops/**`,
  `packages/contracts/**`
- **Hard dependencies:** W43-S04

### Local tasks
1. Update `live-e2e-target-catalog` with `mission_class`,
   `agent_visible_request`, `evaluator_rubric`, `final_code_rubric`, and widened
   budgets.
2. Add `live-e2e-step-quality-assessment-request` and
   `live-e2e-step-quality-assessment-report`.
3. Update `live-e2e-quality-assessment-report` so medium+ all-pass is product
   acceptance evidence.
4. Document the removal of `xl`, raw repo/objective profiles, and generated
   matrix cells.

### Acceptance criteria
1. Contract examples and loader validation cover the breaking policy.
2. Small product-change missions are rejected.
3. Medium+ missions without request/rubric/final-code policy are rejected.
4. `xl` is rejected.

### Done evidence
- updated contract docs and examples
- target catalog validation tests
- runner documentation updates
- `pnpm slice:plan -- W46-S02`

### Out of scope
- Running product-change proof attempts.
- Adding new hard target repositories.

---

## W46-S02 — Step evaluator report and runner behavior
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make per-step external assessment a first-class live E2E artifact
  and continuation gate for product-change missions.
- **Primary modules:** `scripts/live-e2e/**`, `packages/orchestrator-core/**`,
  `scripts/test/**`
- **Hard dependencies:** W46-S01

### Local tasks
1. Generate step-quality assessment requests from public observation, decision,
   and evidence artifacts.
2. Require linked evaluator-authored accepted step reports for medium+
   continuation.
3. Keep small profiles on lightweight flow-health assessment.
4. Ensure `request-repair` routes through public AOR repair, not private target
   mutation.

### Acceptance criteria
1. Missing medium+ step assessment blocks continuation after writing a request.
2. Linked accepted medium+ step assessment allows continuation.
3. Repair decisions never inject private patches or handoffs.

### Done evidence
- step-quality request/report contract validation
- runner output includes step-quality report refs
- live E2E runner tests for continuation behavior
- `pnpm live-e2e:test`

### Out of scope
- Judging final target code quality.
- Direct evaluator mutation of target files.

---

## W46-S03 — Catalog budget and small-canary migration
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Keep small missions as canaries and widen all mission budgets.
- **Primary modules:** `scripts/live-e2e/catalog/**`, `scripts/live-e2e/profiles/**`,
  `docs/ops/**`
- **Hard dependencies:** W46-S01

### Local tasks
1. Set small budgets to 16 files and 900 added lines.
2. Set medium budgets to 32 files and 2200 added lines.
3. Set large budgets to 64 files and 4500 added lines.
4. Set xlarge budgets to 100 files and 10000 added lines.
5. Remove or profile catalog-only cells.

### Acceptance criteria
1. `ky`, `commander-js`, and `pluggy` small cells remain canary targets.
2. Catalog cells without profiles are removed or profiled.
3. Existing profiles resolve explicit matrix cells only.

### Done evidence
- catalog diff with widened budgets
- profile-to-cell consistency check
- retired target notes for removed cells
- `pnpm live-e2e:test`

### Out of scope
- Proving each widened budget through a live provider run.
- Changing provider qualification thresholds.

---

## W46-S04 — Product-change mission rewrite for current targets
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Rewrite current medium/large/xlarge targets as real product-change
  missions with evaluator and final-code rubrics.
- **Primary modules:** `scripts/live-e2e/catalog/targets/**`,
  `scripts/live-e2e/profiles/**`, `docs/ops/**`
- **Hard dependencies:** W46-S03

### Local tasks
1. Rewrite `httpx`, `fastify`, `eslint`, `prettier`, `ruff`, and
   `nextjs-monorepo-example` medium/large missions.
2. Preserve provider qualification as separate from product quality.
3. Keep run-health factual.

### Acceptance criteria
1. Current medium+ profiles are product-change missions.
2. Final all-pass quality is required for product acceptance.
3. Run-health reports do not judge target code quality.

### Done evidence
- rewritten target mission YAML
- contract loader validation
- updated live E2E runbooks
- quality-assessment request/gate evidence

### Out of scope
- Promoting extended candidate targets to required coverage.
- Provider-specific scoring.

---

## W46-S05 — Hard target expansion
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add initial hard targets for more complex product-quality
  evaluation.
- **Primary modules:** `scripts/live-e2e/catalog/targets/**`,
  `scripts/live-e2e/profiles/**`, `docs/ops/**`
- **Hard dependencies:** W46-S04

### Local tasks
1. Add `vitest` or `vite`.
2. Add `sqlalchemy`.
3. Add `biome` or strengthen `ruff`.
4. Keep `django` as a future manual xlarge candidate, not required coverage.

### Acceptance criteria
1. Hard targets have runnable profiles, not catalog-only cells.
2. Hard targets are product-change missions.
3. Hard targets remain extended until proof evidence promotes them.

### Done evidence
- hard target catalog entries
- matching live E2E profiles
- dependency matrix updates
- profile resolution checks

### Out of scope
- Adding Django as required coverage.
- Running overnight/manual xlarge rehearsals.

---

## W46-S06 — Proof-complete acceptance closure and findings intake
- **Epic:** EPIC-0 Foundation; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Move live E2E from implementation-complete local gates to
  proof-complete acceptance by rerunning the required medium, repair, and large
  product-change profiles, collecting terminal pass evidence or classified
  blockers, and keeping source-of-truth documentation honest.
- **Primary modules:** `scripts/live-e2e/**`, `docs/ops/**`, `docs/backlog/**`,
  root checks
- **Hard dependencies:** W46-S05

### Local tasks
1. Preserve the completed implementation hardening: canonical
   `target_checkout_root` changed-path lineage, evaluator-authored
   step-quality gates, fail-closed final quality gates, and public repair-loop
   routing.
2. Rerun `full-journey-regress-httpx-medium-openai.yaml` from a fresh runtime
   root after the changed-path and stale-journal fixes.
3. Rerun `full-journey-repair-fastify-medium-openai.yaml` and verify public
   repair request/report lineage across iterations.
4. Rerun `full-journey-regress-vitest-large-openai.yaml` as the hard-target
   proof, or record a classified provider/environment blocker.
5. For every terminal pass, prepare, validate, and all-pass gate the final
   product-quality assessment.
6. Record every terminal outcome as accepted proof evidence or a classified
   blocker in `docs/ops/live-e2e-proof-complete-findings.md`.
7. Run `git diff --check`, `pnpm live-e2e:test`, `pnpm test`, `pnpm build`,
   and `pnpm check`.

### Acceptance criteria
1. Regression checks pass or blockers are documented.
2. Required medium, repair, and large proof outcomes are summarized with
   profile id, run id, terminal status, owner, phase, class, and next ticket.
3. Terminal pass runs have validated final quality assessment and all-pass
   proof-acceptance evidence.
4. Blocked proof runs are not counted as product-quality acceptance.
5. Findings are assigned to W46-F follow-ups or closed with evidence.
6. Live E2E docs match the implemented black-box product assessment policy.
7. Product-change final acceptance cannot pass with missing canonical target
   checkout evidence, empty meaningful changed paths, missing accepted
   step-quality reports, or source-report/summary changed-path mismatch.

### Done evidence
- `pnpm live-e2e:test`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `docs/ops/live-e2e-proof-complete-findings.md`

### Out of scope
- Publishing provider qualification results.
- Changing release packaging.
