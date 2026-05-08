# W25 implementation slices

## Wave objective
Produce the first real non-mock full-journey production proof with code-changing evidence and no upstream writes.

## Wave exit criteria
- A curated real external-runner profile fails closed without auth, permissions, target verification, or no-write safety.
- One curated public target mission passes end to end with real code-changing evidence.
- Production proof fixtures and story upgrades reject mock-backed claims.

## Sequencing notes
- `W25-S01` starts only after run-level harness ownership and production auth are in place.
- `W25-S02` depends on the real-runner profile and strict delivery gates, and also has an external runner credential prerequisite.
- `W25-S03` can only upgrade stories after the real code-changing pass exists.

---

## W25-S01 — Real external-runner proof profile
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Add a curated full-journey profile that uses a real external runner path rather than deterministic mock output while preserving public-repo safety.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `docs/ops/**`, provider catalog tests
- **Hard dependencies:** W24-S01, W23-S02
- **Primary user-story surfaces:** OPS-06, OPS-07, DEV-03, DEV-04, AIP-12

### Local tasks
1. Create a curated production-proof profile for a public target checkout and real external process runner.
2. Fail preflight closed when runner auth, permissions, target verification, or no-write safety gates are missing.
3. Default to `patch-only` or isolated local branch with no upstream write.
4. Record proof mode fields that distinguish real external process execution from mock-backed coverage.

### Acceptance criteria
1. Preflight fails closed when runner auth, permissions, or target verification are missing.
2. The profile runs only against curated targets and explicit missions.
3. No upstream write is possible by default.

### Done evidence
- real-runner proof profile
- preflight failure tests
- operator runbook updates

### Out of scope
- hosted SaaS proof
- uncurated public repository mutations

---

## W25-S02 — Code-changing full-journey pass
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Run one curated public target mission end to end through CLI/API surfaces and produce a real code-changing full-journey pass without upstream writes.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`
- **Hard dependencies:** W25-S01, W24-S03
- **External blocker:** Requires available real external runner credentials, target checkout access, and permission to execute the curated public-target verification suite locally.
- **Primary user-story surfaces:** OPS-07, DEV-05, DTX-01, DTX-04, FIN-03

### Local tasks
1. Execute the curated profile through CLI/API surfaces using `real-external-process` mode.
2. Verify post-run target checks, Runtime Harness pass, review pass, and delivery manifest materialization.
3. Capture changed-path evidence proving meaningful mission-scoped code changes.
4. Confirm no upstream write occurred.

### Acceptance criteria
1. Proof fields include `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.
2. All required target verdicts pass.
3. Runtime Harness, review, and delivery manifest evidence exists.
4. No upstream write occurred.

### Done evidence
- real full-journey run transcript
- Runtime Harness pass report
- review pass report
- delivery manifest
- no-upstream-write assertion

### Out of scope
- mock-backed production proof
- production claim with warn-only target verdicts

---

## W25-S03 — Proof fixture and story upgrade
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Commit the refreshed real proof fixture and upgrade only the stories proven by W25-S02 to proof-covered.
- **Primary modules:** `examples/live-e2e/**`, `docs/product/**`, `scripts/test.mjs`, `docs/ops/**`
- **Hard dependencies:** W25-S02, W22-S01
- **Primary user-story surfaces:** OPS-07 and related production-proof stories

### Local tasks
1. Commit a refreshed proof fixture only after W25-S02 passes.
2. Upgrade OPS-07 and directly proven related stories to `proof-covered` with executable evidence refs.
3. Extend proof integrity checks so mock-backed `full_code_changing_runtime` claims are rejected.
4. Leave unproven stories partial or blocked.

### Acceptance criteria
1. Proof integrity rejects mock-backed production claims.
2. Story upgrades are limited to evidence-backed outcomes.
3. The committed fixture contains no target checkout, secrets, or runtime state outside fixture scope.

### Done evidence
- refreshed production proof fixture
- updated story matrix proof-covered rows
- proof integrity test output

### Out of scope
- blanket story upgrades
- committing `.aor/` runtime state or target checkouts
