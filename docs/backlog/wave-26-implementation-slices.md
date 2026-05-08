# W26 implementation slices

## Wave objective
Make self-hosted production readiness repeatable, reviewable, and documented as a CLI/API production candidate with optional web.

## Wave exit criteria
- A separate production-readiness gate verifies production evidence beyond root baseline checks.
- Production-touched hotspots are stabilized without unrelated redesign.
- Self-hosted CLI/API production candidate docs are complete and bounded to declared non-goals.

## Sequencing notes
- `W26-S01` depends on the W25 proof fixture plus W23/W24 production-hardening evidence.
- `W26-S02` follows the gate so stabilization stays scoped to production-touched hotspots.
- `W26-S03` follows the gate so release docs do not claim self-hosted production candidate status early.

---

## W26-S01 — Production readiness gate
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Add a separate production-readiness gate distinct from baseline `pnpm check` that cannot pass without W25 real proof evidence.
- **Primary modules:** `scripts/**`, `docs/ops/**`, `docs/backlog/**`, `examples/live-e2e/**`
- **Hard dependencies:** W25-S03, W23-S01, W23-S02, W24-S01
- **Primary user-story surfaces:** production readiness, security, proof, and story traceability surfaces

### Local tasks
1. Define the production-readiness check/runbook separately from root baseline checks.
2. Verify honest story statuses, no source-of-truth drift, auth hardening, nested contracts, run-level harness evidence, and real proof fixture.
3. Fail closed when W25 proof evidence is absent or mock-backed.
4. Document the difference between baseline integrity and production readiness.

### Acceptance criteria
1. The production-readiness gate cannot pass without W25 proof evidence.
2. Baseline `pnpm check` remains a repository-integrity gate rather than a production claim.
3. The gate output is reviewable and operator-runbook aligned.

### Done evidence
- production-readiness check or runbook
- failing test fixture without W25 evidence
- passing fixture only after real proof exists

### Out of scope
- renaming `pnpm check` into a production gate
- SaaS/enterprise identity checks

---

## W26-S02 — Maintainability stabilization
- **Epic:** EPIC-0 Repository development system
- **State:** ready
- **Outcome:** Decompose only the production-touched hotspots needed for maintainability: live E2E flows, step execution, API projections, and web console surfaces.
- **Primary modules:** `scripts/live-e2e/**`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, tests
- **Hard dependencies:** W26-S01
- **Primary user-story surfaces:** maintainability and testability surfaces affected by production gates

### Local tasks
1. Identify hotspots touched by W23-W26 production work.
2. Extract behavior-preserving helpers where complexity blocks review or testability.
3. Keep public CLI/API/web output shapes stable.
4. Avoid unrelated redesigns or visual rewrites.

### Acceptance criteria
1. Behavior-preserving tests pass after each extraction.
2. No unrelated redesign or source-of-truth churn is included.
3. Hotspots changed by production slices become easier to test and review.

### Done evidence
- focused refactoring diffs
- before/after targeted tests
- complexity or ownership notes where useful

### Out of scope
- broad architecture rewrite
- cosmetic web redesign

---

## W26-S03 — Self-hosted release documentation
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Document the supported production mode as self-hosted CLI/API with optional web, including runbook, rollback, auth, proof evidence, and non-goals.
- **Primary modules:** `README.md`, `docs/ops/**`, `docs/backlog/**`, `docs/product/**`
- **Hard dependencies:** W26-S01
- **Primary user-story surfaces:** operator, security, delivery, release, and production readiness surfaces

### Local tasks
1. Document supported self-hosted production mode: CLI/API required, web optional/detachable.
2. Include operator runbook, rollback notes, no-write/write-back policy, auth config, proof evidence, and known non-goals.
3. Update final verdict wording only after W26 gate passes.
4. Keep hosted SaaS and enterprise identity out of scope.

### Acceptance criteria
1. Docs can change final verdict to self-hosted production candidate only after W26 gate passes.
2. No doc claims hosted SaaS or enterprise identity support.
3. Operators can find auth, rollback, delivery, and proof evidence procedures from one release doc path.

### Done evidence
- self-hosted release runbook
- README final status update after gate pass
- linked W25 proof evidence

### Out of scope
- hosted SaaS runbook
- enterprise identity setup guide
