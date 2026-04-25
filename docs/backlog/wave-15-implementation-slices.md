# W15 implementation slices

## Wave objective
Reopen the completed queue with readiness-hardening work that removes false readiness signals, aligns workspace/package evidence, and makes live E2E proof claims machine-checkable.

## Wave exit criteria
- source-of-truth docs describe W15 as the active readiness-hardening queue after W14 matrix coverage
- package/module map entries are backed by package-managed workspace manifests
- root checks fail on stale wave-coverage wording, package/module map drift, or dishonest proof-bundle claims
- real code-changing full-journey proof remains explicitly blocked until a non-mock external runner can produce `overall_verdict=pass`

## Sequencing notes
- `W15-S01` starts first because the shared backlog and source-of-truth docs must reopen the queue before implementation hardening is accepted.
- `W15-S02` and `W15-S03` depend on `W15-S01` because package/proof checks need the W15 policy language to be authoritative.
- `W15-S04` depends on `W15-S03` and stays blocked until real external-runner prerequisites exist.

---

## W15-S01 — Source-of-truth and readiness queue repair
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Reopen the backlog with a W15 readiness-hardening wave and remove stale W11-era current-state claims.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/ops/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, AI platform owner

### Local tasks
1. Add W15 to roadmap, master backlog, epic map, and dependency graph.
2. Update current-state docs so W14 is matrix coverage and W15 is the active readiness-hardening queue.
3. Document that the W10-S05 dependency on W11-S05 is a historical closure dependency, not normal forward wave order.
4. Keep W15-S04 blocked until a real code-changing full-journey proof is available.

### Acceptance criteria
1. Shared backlog docs agree on W15 slice ids, states, epics, and dependencies.
2. `pnpm slice:status` reports W15 work instead of an exhausted queue.
3. Source-of-truth docs no longer describe W11 as the current planning limit.
4. W10/W11 dependency wording is explicit enough to avoid confusing implementation order.

### Done evidence
- synchronized W15 entries across roadmap, backlog, epics, and dependency graph
- updated source-of-truth wording in README and backlog operating model
- root backlog consistency checks passing with W15 included

### Out of scope
- package manifest changes
- proof-bundle integrity gate implementation
- executing real live E2E proof

---

## W15-S02 — Package/module workspace alignment
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Ensure every runtime app/package listed in the module map is represented as a package-managed workspace.
- **Primary modules:** `apps/**/package.json`, `packages/**/package.json`, `docs/architecture/13-package-and-module-map.md`, `scripts/build.mjs`
- **Hard dependencies:** W15-S01
- **Primary user-story surfaces:** repository / multirepo owner, engineering manager / planner

### Local tasks
1. Add private package manifests for folder-backed apps and packages that currently lack them.
2. Update package/module map language so listed apps/packages are package-managed workspaces.
3. Extend scaffold checks to compare documented module paths with workspace package manifests.
4. Refresh workspace install metadata if package discovery changes the lockfile.

### Acceptance criteria
1. Every app/package listed in the module map exists on disk and has `package.json`.
2. Every package-managed app/package under `apps/*` and `packages/*` is listed in the module map.
3. `pnpm install` discovers the aligned workspace set.
4. `pnpm build` fails on package/module map drift.

### Done evidence
- package manifests for all listed runtime apps/packages
- module-map scaffold validation in `scripts/build.mjs`
- passing `pnpm install`, `pnpm build`, and `pnpm check`

### Out of scope
- changing runtime import paths
- publishing packages

---

## W15-S03 — Proof verdict integrity gates
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make committed live E2E proof claims machine-checkable so `pass_with_findings` coverage proof cannot be mistaken for full runtime proof.
- **Primary modules:** `scripts/test.mjs`, `examples/live-e2e/**`, `docs/ops/**`, `README.md`
- **Hard dependencies:** W15-S01
- **Primary user-story surfaces:** operator / SRE, reviewer / QA, finance / audit / hygiene

### Local tasks
1. Add proof metadata that distinguishes coverage proof from real code-changing runtime proof.
2. Add root test checks for stale source-of-truth claims and dishonest proof wording.
3. Require W14 `pass_with_findings` proof bundles to carry explicit coverage-with-findings metadata.
4. Document that W14 matrix proof is not the final real-code-change acceptance proof.

### Acceptance criteria
1. `pnpm test` fails if latest-wave source-of-truth wording is stale.
2. `pnpm test` fails if a `pass_with_findings` proof lacks `proof_scope=coverage_with_findings`.
3. `pnpm test` fails if docs claim W14 coverage proof is a full production/runtime pass.
4. Existing W14 proof remains accepted only as honest coverage evidence.

### Done evidence
- proof metadata in committed W14 evidence bundle
- source-of-truth and proof-integrity checks in `scripts/test.mjs`
- updated live E2E docs describing coverage proof versus full runtime proof

### Out of scope
- creating a new real external-runner proof

---

## W15-S04 — Real code-changing full-journey proof
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Produce a full-journey proof for `ky.regress.small.openai` that materializes real mission code changes through a non-mock external runner and reaches `overall_verdict=pass`.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `.aor/` runtime output
- **Hard dependencies:** W15-S03
- **External blocker:** Non-mock external runner credentials/binary are not yet available for a real `ky.regress.small.openai` code-changing proof.
- **Primary user-story surfaces:** delivery engineer, reviewer / QA, operator / SRE

### Local tasks
1. Run `scripts/live-e2e/profiles/full-journey-regress-ky.yaml` without `--examples-root` fixture override.
2. Use a real supported external runner rather than deterministic external-runner mock.
3. Confirm the target checkout contains mission code changes and review reports `code_quality.status=pass`.
4. Commit only curated proof fixtures, keeping raw runtime output under `.aor/`.

### Acceptance criteria
1. The selected required matrix cell is `ky.regress.small.openai`.
2. The proof records `external_runner_mode` as non-mock external execution.
3. The run summary has `verdict_matrix.overall_verdict=pass`.
4. The review report has `code_quality.status=pass`.
5. The committed proof bundle has `proof_scope=full_code_changing_runtime` and `real_code_change_proof_complete=true`.

### Done evidence
- verified run summary and review report from a non-mock full-journey run
- refreshed committed proof bundle for the selected matrix cell
- passing `pnpm check`

### Out of scope
- faking code changes or marking mock-backed proof as full runtime proof
- enabling upstream public-repo write-back by default
