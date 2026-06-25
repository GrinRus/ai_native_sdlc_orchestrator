# W50 implementation slices

W50 closes the two real blockers from the W49 control run without weakening
black-box product live E2E gates. Fastify is treated as review/repair
convergence work: verification-mapping warnings must not become code repair
when verification and code quality already pass. Vitest is treated as live E2E
target setup hygiene: incompatible Node must fail fast before expensive target
commands or product execution.

## W50-S01 — Review verification mapping and residual-risk classification

- **Outcome:** Review reports preserve changed-test verification coverage and
  classify broad verification mapping warnings as non-repair evidence when
  primary verification, code quality, and size fit pass.
- **Epic:** EPIC-4, EPIC-7
- **State:** ready
- **Primary modules:** `docs/contracts/review-report.md`,
  `packages/contracts/**`, `packages/orchestrator-core/src/review-run.mjs`,
  review tests
- **Hard dependencies:** W49-S04

### Local tasks
1. Add `artifact_quality.verification_coverage` to the review-report contract,
   canonical example, loader validation, and docs.
2. Treat broad repo/package commands such as `npm run test:ci`, `pnpm test`,
   and repo-wide `pytest` as covering changed test files when semantics are
   broad enough.
3. Keep strict failures for missing verify summary, failed verification, empty
   meaningful changed paths, out-of-scope paths, and real code-quality failures.

### Acceptance criteria
1. Changed Fastify test files covered by `npm run test:ci` do not create a
   repair-driving review warning.
2. Changed test files outside explicit, package, workspace, or broad test
   coverage still produce artifact-quality warning evidence.
3. `review-decision.decision` remains `approve|hold|request-repair`.

### Done evidence
- contract/example validation
- review-run regression tests
- focused Fastify review coverage test

### Out of scope
- weakening final all-pass product acceptance
- changing the `review-decision.decision` enum

## W50-S02 — Live E2E target toolchain fail-fast and setup-journal hygiene

- **Outcome:** Profiles with `target_toolchain.node.required_range` block before
  `project verify` if no compatible Node is available, and setup evidence keeps
  public `project init` success distinct from later target setup blockers.
- **Epic:** EPIC-7
- **State:** ready
- **Primary modules:** `scripts/live-e2e/lib/flows.mjs`,
  `scripts/live-e2e/run-profile.mjs`, profile docs, runner tests
- **Hard dependencies:** W50-S01

### Local tasks
1. Evaluate target Node policy before target install/build/test/lint commands.
2. Honor `AOR_LIVE_E2E_TARGET_NODE_BIN` and prepend its directory through the
   generated target command wrappers.
3. Write `target_toolchain_preflight_file` into run summary, observation report,
   setup journal, and target pre-execution status evidence.
4. Preserve `setup_journal.project_bootstrap=pass` when public `project init`
   exited 0 even if later target readiness blocks.

### Acceptance criteria
1. Vitest large without compatible Node blocks as
   `environment/target_setup/environment_node_version_unsupported` before
   expensive target commands.
2. Vitest large with compatible `AOR_LIVE_E2E_TARGET_NODE_BIN` proceeds past
   target setup or reveals a new non-W49 blocker.
3. Old W46 `.aor` scan and missing `packages/vitest/dist/cli.js` blockers do not
   recur.

### Done evidence
- runner unit tests for target toolchain preflight
- setup journal/run summary evidence refs
- `pnpm live-e2e:test`

### Out of scope
- provisioning a compatible Node runtime on every host
- changing Vitest product mission acceptance criteria

## W50-S03 — Fastify/Vitest control rerun and product acceptance closure

- **Outcome:** Re-run the control proof subset after W50 changes and claim
  product acceptance only for terminal pass plus final all-pass quality gate.
- **Epic:** EPIC-0, EPIC-7
- **State:** ready
- **Primary modules:** `scripts/live-e2e/**`,
  `docs/ops/live-e2e-proof-complete-findings.md`, root checks, live proof runs
- **Hard dependencies:** W50-S02

### Local tasks
1. Re-run guided UI and HTTPX medium if the same-commit pairing changed.
2. Re-run Fastify repair medium and verify no second repair starts from a
   broad verification mapping warning alone.
3. Re-run Vitest large with compatible Node when available, or record the
   pre-execution environment blocker.
4. Prepare, validate, and gate final quality reports only for terminal passing
   product-change runs.

### Acceptance criteria
1. Fastify reaches QA/delivery or blocks with a precise non-repair class such
   as `verification_mapping_gap`, not generic anti-loop repair.
2. Vitest no longer starts target install/build/test/lint after incompatible
   Node is already known.
3. Blocked proof runs remain non-accepted product quality.

### Done evidence
- W50 live proof run ids and summaries
- final quality validate/gate output for accepted product runs
- findings doc update

### Out of scope
- optional xlarge overnight proof
- committing `.aor/` runtime artifacts

## W50-S04 — Findings/backlog state sync

- **Outcome:** Findings, backlog, roadmap, and dependency graph accurately
  distinguish W49 blockers from W50 fixes and W50 proof evidence.
- **Epic:** EPIC-0, EPIC-7
- **State:** ready
- **Primary modules:** `docs/backlog/**`,
  `docs/ops/live-e2e-proof-complete-findings.md`
- **Hard dependencies:** W50-S03

### Local tasks
1. Mark W49 blockers open until W50 rerun evidence exists.
2. Record W50 run ids, profile ids, terminal status, owner/phase/class,
   all-pass gate result, accepted findings, and next tickets.
3. Keep `.aor/` and raw runtime state uncommitted.

### Acceptance criteria
1. Findings doc claims product acceptance only after final
   `quality-assessment gate --policy all-pass`.
2. Roadmap, implementation backlog, epic map, and dependency graph include W50.
3. Local regression gates are recorded with any unresolved environment/provider
   blockers.

### Done evidence
- backlog consistency checks
- updated proof findings doc
- no tracked runtime state

### Out of scope
- retroactively changing W49 run outcomes
- provider qualification policy changes
