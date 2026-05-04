# W16 implementation slices

## Wave objective
Reduce implementation complexity after W15 readiness hardening by decomposing monolithic runtime surfaces, extracting repeated helpers, and completing contract-first adapter permission cleanup without changing unrelated public behavior.

## Wave exit criteria
- complexity hotspots have explicit refactor slices and acceptance evidence
- shared helper logic is extracted where repeated across packages without changing public CLI/API output shapes
- CLI, API, core, contracts, and live E2E runner decomposition preserves current command names, route paths, contract family names, and proof output shapes
- adapter permission legacy fallback fails through an explicit permission-policy validation path

## Sequencing notes
- `W16-S01` starts first because it records the refactor queue and extracts behavior-neutral helper seams.
- `W16-S02` through `W16-S05` depend on `W16-S01` so the larger decompositions can use the same helper conventions.
- `W16-S06` depends on `W16-S01`; its negative legacy-fallback evidence must stay linked before the slice state is advanced.

---

## W16-S01 — Complexity baseline and shared helper extraction
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Add the refactor wave and extract repeated helper logic without changing runtime behavior.
- **Primary modules:** `docs/backlog/**`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `apps/api`, test helpers
- **Hard dependencies:** none
- **Primary user-story surfaces:** repository / multirepo owner, engineering manager / planner

### Local tasks
1. Add W16 across roadmap, master backlog, epic map, dependency graph, and source-of-truth docs.
2. Extract repeated value, evidence, JSON, path, and changed-path helpers into package-local utility modules.
3. Replace duplicated helper definitions in low-risk core modules first.
4. Add targeted tests or preserve existing regression coverage for unchanged outputs.

### Acceptance criteria
1. `pnpm slice:status` reports W16 as the current queue.
2. Shared helper extraction does not change public command outputs or contract family names.
3. Root backlog consistency checks include all W16 slices.
4. Targeted tests for touched packages pass.

### Done evidence
- synchronized W16 entries across backlog docs
- package-local shared helper modules used by at least two runtime modules
- passing targeted tests for touched modules

### Out of scope
- public CLI/API shape changes
- contract-breaking adapter permission removal

---

## W16-S02 — CLI dispatcher decomposition
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Split the monolithic CLI dispatcher into command-group handlers and one output builder while preserving existing public CLI output.
- **Primary modules:** `apps/cli`
- **Hard dependencies:** W16-S01
- **Primary user-story surfaces:** operator / SRE, delivery engineer

### Local tasks
1. Introduce command handler modules grouped by lifecycle area.
2. Replace mutable output locals with a single output-state object and `buildCliOutput`.
3. Keep `invokeCli` and `runCli` exports unchanged.
4. Refresh CLI fixtures only if field ordering or generated evidence legitimately changes.

### Acceptance criteria
1. Every currently implemented command still returns the documented JSON fields.
2. CLI tests pass without requiring command name or flag changes.
3. Command catalog alignment remains unchanged.
4. `apps/cli/src/index.mjs` no longer owns command-specific business logic for every command group.

### Done evidence
- command-group handler modules
- unchanged or intentionally refreshed CLI fixtures
- passing CLI tests

### Out of scope
- adding new CLI commands
- changing JSON field names or command flags

---

## W16-S03 — API and read-surface decomposition
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Split detached HTTP transport and read projections into route/auth/body/SSE helpers and read-model modules without changing HTTP behavior.
- **Primary modules:** `apps/api`
- **Hard dependencies:** W16-S01
- **Primary user-story surfaces:** operator / SRE, reviewer / QA

### Local tasks
1. Move auth normalization/authorization into an API auth module.
2. Move JSON response/body parsing and route matching into transport helpers.
3. Move SSE write/subscription handling into a stream helper.
4. Split run-summary projection from raw artifact readers.

### Acceptance criteria
1. Existing API routes, status codes, and payload shapes stay unchanged.
2. SSE stream replay and live event behavior remains covered by tests.
3. Read-surface tests pass with the same query semantics.
4. HTTP transport module is reduced to route registration and orchestration.

### Done evidence
- API helper modules
- passing API transport, stream, and read-surface tests

### Out of scope
- introducing NestJS or a new HTTP framework
- changing control-plane API contracts

---

## W16-S04 — Orchestrator-core execution decomposition
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Break routed execution, delivery, and mission-scope logic into focused modules while preserving step-result and runtime-harness behavior.
- **Primary modules:** `packages/orchestrator-core`
- **Hard dependencies:** W16-S01
- **Primary user-story surfaces:** delivery engineer, reviewer / QA

### Local tasks
1. Extract shared changed-path and mission-scope helpers used by execution, review, and runtime-harness reports.
2. Split routed-step preparation, delivery guard evaluation, adapter invocation, result writing, and harness refresh.
3. Split delivery driver mode implementations from the driver coordinator.
4. Preserve existing step-result and delivery-manifest contract outputs.

### Acceptance criteria
1. Routed dry-run and live guarded execution tests pass.
2. Runtime Harness report tests pass with unchanged decision semantics.
3. Delivery driver tests pass for no-write, patch/local-branch, and fork-first planning paths.
4. Public orchestrator-core exports remain compatible.

### Done evidence
- focused core helper/execution modules
- passing orchestrator-core tests

### Out of scope
- changing delivery modes
- changing Runtime Harness decision vocabulary

---

## W16-S05 — Installed-user live E2E runner decomposition
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Split the internal installed-user proof runner into reusable library modules while preserving flags, profile behavior, and proof outputs.
- **Primary modules:** `scripts/live-e2e/**`, `scripts/test/**`
- **Hard dependencies:** W16-S01
- **Primary user-story surfaces:** operator / SRE, reviewer / QA

### Local tasks
1. Move profile/catalog loading into `scripts/live-e2e/lib`.
2. Move target checkout/materialization and preflight helpers into dedicated modules.
3. Move installed-user/full-journey execution and verdict construction into focused modules.
4. Keep `scripts/live-e2e/run-profile.mjs` as the CLI entrypoint.

### Acceptance criteria
1. Existing live E2E proof-runner tests pass.
2. Existing profile flags and generated proof bundle shapes remain unchanged.
3. No public CLI live-e2e surface is reintroduced.
4. Runtime output still stays under `.aor/` and remains uncommitted.

### Done evidence
- `scripts/live-e2e/lib/**` modules
- passing proof-runner tests

### Out of scope
- producing the blocked real code-changing W15-S04 proof
- enabling upstream public-repo writes

---

## W16-S06 — Adapter permission legacy removal
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Move live adapter permission execution from legacy `external_runtime.args` fallback to explicit `permission_policy` modes through a contract-first migration.
- **Primary modules:** `docs/contracts/**`, `examples/adapters/**`, `packages/adapter-sdk`, `packages/contracts`
- **Hard dependencies:** W16-S01
- **Primary user-story surfaces:** delivery engineer, security / compliance, AI platform owner

### Local tasks
1. Isolate permission-policy selection behind a named helper.
2. Update adapter capability contract docs to make `permission_policy.modes` the required live execution source.
3. Update adapter examples and contract validation to distinguish required mode args from unsupported legacy args.
4. Fail legacy fallback only after negative validation evidence is committed.

### Acceptance criteria
1. Adapter tests cover explicit permission-policy mode selection and unsupported legacy fallback behavior.
2. Contract docs and examples agree on required permission-policy mode execution.
3. Reference-integrity tests continue to reject dishonest live adapter metadata.
4. Legacy fallback removal, if enabled, returns blocked semantics instead of synthetic success.

### Done evidence
- adapter permission-policy validation helper
- updated contract docs/examples/tests
- passing adapter SDK and contract tests

### Out of scope
- changing `mock-runner` dry-run semantics
- adding a new provider adapter
