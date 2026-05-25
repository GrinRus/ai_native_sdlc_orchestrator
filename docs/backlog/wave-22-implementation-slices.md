# W22 implementation slices

## Wave objective
Repair source-of-truth claims so the repository distinguishes baseline readiness from production readiness and treats OpenCode as extended candidate coverage until real certification exists.

## Wave exit criteria
- Story coverage uses evidence-strength statuses across the original 112 stories.
- Production readiness docs state that the W22 baseline is not yet production-ready and name the W23-W26 release criteria.
- OpenCode is downgraded to extended candidate coverage until real certification exists.

## Sequencing notes
- `W22-S01` starts first because the story registry must stop using blanket production-like coverage claims.
- `W22-S02` depends on `W22-S01` so readiness wording can reuse the evidence-strength vocabulary.
- `W22-S03` depends on `W22-S01` so OpenCode story rows and catalog maturity agree.

---

## W22-S01 — Evidence-strength story coverage model
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Replace blanket story coverage with an evidence-strength status model that distinguishes baseline implementation from production proof.
- **Primary modules:** `docs/product/**`, `docs/backlog/**`, `scripts/test.mjs`
- **Hard dependencies:** none
- **Primary user-story surfaces:** the original 112 story IDs, especially production-proof and OpenCode rows

### Local tasks
1. Replace the story matrix status vocabulary with `baseline-covered`, `proof-covered`, `partial`, and `blocked`.
2. Reclassify the original 112-story registry into baseline-covered, partial, and blocked rows using executable evidence rather than docs-only claims.
3. Keep partial and blocked stories pointed at non-done gap slices that own the missing executable proof.
4. Update the matrix checker so old `covered` and `gap` statuses fail fast.
5. Record the current counts and make future proof upgrades explicit.

### Acceptance criteria
1. The story matrix still machine-checks exactly the story rows defined at W22 across the supported role clusters.
2. No row claims production proof unless an executable proof path exists and the row uses `proof-covered`.
3. Partial and blocked rows reference only not-yet-done gap slices.
4. The checker rejects the old blanket `covered` vocabulary.

### Done evidence
- updated `docs/product/user-story-coverage-matrix.md` with evidence-strength statuses
- updated `scripts/test.mjs` coverage-status validation
- passing `pnpm test` user-story coverage matrix checks

### Out of scope
- implementing missing production runtime behavior
- upgrading any story to production proof without W25 evidence

---

## W22-S02 — Production readiness source-of-truth
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Create a single self-hosted production-readiness source of truth that separates current baseline readiness from future production release criteria.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**`
- **Hard dependencies:** W22-S01
- **Primary user-story surfaces:** operator, security, delivery, and production proof story surfaces

### Local tasks
1. Add a production-readiness source-of-truth document for self-hosted CLI/API mode with optional web.
2. Update README and roadmap wording so completed baseline slices cannot be read as production-ready runtime status.
3. List production blockers and release criteria without pretending W23-W26 implementation already exists.
4. Keep hosted SaaS and enterprise identity explicitly out of scope.

### Acceptance criteria
1. README, roadmap, story matrix, and readiness docs agree that the W22 baseline is not yet production-ready.
2. The `125/125` historical baseline completion signal is no longer presented as production readiness.
3. Production release criteria name auth, nested contracts, run-level harness, delivery gates, and real proof requirements.

### Done evidence
- new self-hosted production-readiness source-of-truth doc
- updated README and backlog source-of-truth references
- passing latest-wave and backlog consistency checks

### Out of scope
- building hosted SaaS readiness
- implementing W23-W26 runtime gates

---

## W22-S03 — OpenCode maturity downgrade
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Downgrade OpenCode from certified required baseline language to extended candidate coverage until real live certification exists.
- **Primary modules:** `examples/adapters/**`, `scripts/live-e2e/catalog/**`, `docs/ops/**`, `docs/backlog/**`, `docs/product/**`, contract tests
- **Hard dependencies:** W22-S01
- **Primary user-story surfaces:** DEV-04, AIP-12, OPS-07

### Local tasks
1. Set OpenCode provider catalog coverage to `extended` and adapter certification state to candidate.
2. Keep the OpenCode target cell cataloged without treating it as mandatory baseline coverage.
3. Update docs that previously described W20-S03 as required live-baseline certification.
4. Preserve validation coverage so a future required OpenCode promotion must still prove live-runnable permission policy support.

### Acceptance criteria
1. No source claims OpenCode is a required or certified baseline without live evidence.
2. OpenCode remains discoverable as an extended/candidate provider path.
3. Contract tests still reject a required OpenCode promotion when permission policy evidence is missing.

### Done evidence
- updated OpenCode adapter and provider catalog entries
- updated OpenCode maturity wording across product, ops, and backlog docs
- updated live E2E catalog reference test for future required promotion

### Out of scope
- recertifying OpenCode as required baseline
- removing the OpenCode adapter example or profile
