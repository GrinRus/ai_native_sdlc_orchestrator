# W40 - post-alpha.7 installed-user and provider qualification hardening

Turn the `0.1.0-alpha.7` release and installed-user smoke findings into the next
bounded backlog wave. The wave keeps the npm alpha channel honest, improves the
no-settings local UI path, makes in-flight live E2E provider activity easier to
understand, and defines optional provider qualification without treating Qwen,
OpenCode, or Claude as required coverage.

## Wave objective

An installed user should be able to install the npm alpha, launch `aor app`,
understand the clean UI onboarding path, and diagnose live E2E provider progress
from public UI/report surfaces. Provider qualification must separate AOR product
failures, target repository blockers, provider failures, and local environment
issues before any release or readiness claim is made.

## Wave exit criteria

- The post-alpha.7 backlog baseline is represented across the roadmap, master
  backlog, dependency graph, epic map, and this owning wave document.
- Installed-user smoke docs explain how to run registry package checks from a
  neutral temp runner so local checkout package metadata cannot shadow
  `npm exec --package` bin resolution.
- `aor app` onboarding copy, first-run states, explicit initialization, first
  flow handoff, project switcher, and user-facing errors are hardened from the
  alpha.7 smoke findings without adding hosted/SaaS scope.
- Live E2E UI and operator reports expose active provider heartbeat/progress
  while provider execution is still running, including elapsed/budget and last
  progress labels from public read/event surfaces.
- Release and onboarding docs tell one coherent installed-user story for alpha
  install, clean UI launch, no surprise writes, and advanced headless commands.
- Provider qualification is tracked through an optional coverage matrix that
  preserves provider parity lifecycle semantics and separates provider,
  target-repository, environment, and AOR failure ownership.

---

## W40-S01 — Post-alpha.7 backlog and product baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Open W40 with source-of-truth backlog, roadmap, dependency, and traceability entries after the alpha.7 release.
- **Primary modules:** `docs/backlog/**`, `docs/product/**`, `docs/ops/**`
- **Hard dependencies:** W39-S01, W36-S05
- **Primary user story surfaces:** no direct story closure; planning baseline for installed-user and live E2E follow-up work.

### Local tasks
1. Record the W40 wave goal, exit criteria, and out-of-scope boundaries.
2. Add W40 slices to the master backlog with one ready implementation slice.
3. Add W40 hard dependencies and topological order entries.
4. Add W40 roadmap summary and story allocation rows.
5. Update the epic map so W40 ownership is visible from EPIC-0, EPIC-1, EPIC-6, and EPIC-7.
6. Run `pnpm slice:status`, `pnpm slice:next -- --json`, and `pnpm slice:gate`.

### Acceptance criteria
1. Backlog tooling reports W40-S02 as the next ready slice and no stale blocked W35/W38/W39 work.
2. The W40 baseline does not claim a new npm release, stable readiness, hosted/SaaS, Docker/GHCR, SDK release, or mandatory Qwen qualification.
3. The next implementation slice has enough context to start without reading this chat thread.

### Done evidence
- updated roadmap, master backlog, dependency graph, epic map, and owning W40 wave doc
- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:gate`

### Out of scope
- Runtime, API, CLI, web, or live E2E code changes.
- Publishing another npm version.

---

## W40-S02 — Installed-user onboarding and release docs hardening
- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Make the published npm alpha and no-settings `aor app` first run easier to verify and use after alpha.7 smoke findings.
- **Primary modules:** `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W40-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-06, OPS-10.

### Local tasks
1. Audit README and ops runbooks for installed-user alpha launch, clean UI onboarding, and smoke commands.
2. Document the neutral temp-runner requirement for `npm exec --package @grinrus/aor@<version>` so registry smoke cannot be confused with current-checkout execution.
3. Review `aor app` first-run wizard states for uninitialized project, initialized project without flows, active flow, completed flows, and multi-project switching.
4. Improve user-facing path/runtime/profile error messages where alpha.7 smoke shows raw or ambiguous guidance.
5. Add or update smoke/regression coverage for the documented installed-user command path and no-surprise-write guarantee.
6. Run targeted tests, `pnpm web:build` if web changes are made, and `pnpm slice:gate`.

### Acceptance criteria
1. A user can follow the primary README path from install to `aor app` without reading internal release notes.
2. Registry smoke commands are explicitly safe from local package shadowing and prove the published package.
3. Clean UI onboarding remains explicit: no `.aor/` runtime is created on page load before user initialization.
4. Multi-project UI guidance states that projects are added explicitly and runtime/evidence state remains isolated.
5. Any UI or CLI error copy changed by this slice is covered by tests or smoke evidence.

### Done evidence
- updated README and ops runbooks
- installed-user smoke command evidence from a neutral temp runner
- targeted CLI/web tests or smoke assertions
- slice gate output

### Out of scope
- New provider execution behavior.
- Hosted workspace or SaaS onboarding.
- Another npm release.

---

## W40-S03 — Active live E2E heartbeat surfacing
- **Epic:** EPIC-6 Operator surface; EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Show provider heartbeat/progress while a live E2E provider step is still running, not only after final artifacts are available.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, `scripts/live-e2e/**`, `docs/contracts/**`, tests
- **Hard dependencies:** W40-S01, W35-S01, W38-S01, W39-S01
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Review current provider status read surfaces, live event stream, run summaries, and web polling/SSE behavior.
2. Define any additive contract fields needed to expose active provider heartbeat from public control-plane/event surfaces.
3. Ensure Codex, Claude, OpenCode, and Qwen use the same lifecycle semantics while preserving adapter-specific progress labels.
4. Render active elapsed/budget/status/progress in the stage rail and cockpit during execution, including refresh/resume behavior.
5. Add synthetic live E2E tests for running, silent-running, progress-updated, timeout-risk, interrupted, and terminal states.
6. Run targeted runtime/API/web tests, `pnpm live-e2e:test`, `pnpm web:build`, and `pnpm slice:gate`.

### Acceptance criteria
1. Active provider status is visible without private process inspection.
2. Qwen stream progress, Codex stdout/activity, and non-streaming providers map to shared public status semantics.
3. A terminal provider result still preserves W39 zero-internal-repair behavior.
4. Page refresh or API reread does not lose the latest active status summary.
5. UI copy distinguishes true silence from observed provider progress.

### Done evidence
- updated contracts/runbooks if public fields change
- runtime/control-plane tests
- web rendering tests or smoke evidence
- live E2E synthetic status coverage
- slice gate output

### Out of scope
- Changing provider qualification tiers.
- Adding private provider log dependencies.
- Reintroducing internal repair after terminal provider failure.

---

## W40-S04 — Optional provider qualification matrix
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Define and prove a provider qualification matrix that records optional coverage status without turning extended providers into release blockers.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `docs/ops/**`, `docs/product/**`, tests
- **Hard dependencies:** W40-S03, W39-S01
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06, OPS-07.

### Local tasks
1. Define provider qualification dimensions: provider, adapter, coverage tier, auth/environment readiness, target setup readiness, provider execution result, operator evidence, and final verdict.
2. Document how target repository blockers, environment blockers, provider blockers, and AOR product failures are classified and displayed.
3. Add matrix fixtures or reports for Codex, Claude, OpenCode, and Qwen without making optional providers required release coverage.
4. Run short live E2E qualification checks where credentials and environment allow; otherwise record explicit fail-closed blocker evidence.
5. Add regression tests that qualification status cannot be inferred from provider name alone and cannot mask AOR product failures as provider blockers.
6. Run `pnpm live-e2e:test` and `pnpm slice:gate`.

### Acceptance criteria
1. Provider qualification is readable from docs/reports without opening raw logs.
2. Optional providers can be `qualified`, `candidate`, `blocked`, or `not-run` with owner/phase evidence.
3. Qwen/OpenCode/Claude remain optional unless a future release policy explicitly changes coverage tier.
4. Target repository failures and environment/auth blockers do not count as AOR pass or provider quality pass.
5. The matrix preserves W39 provider lifecycle parity.

### Done evidence
- provider qualification matrix docs and examples
- live E2E or explicit blocker evidence
- classification regression tests
- slice gate output

### Out of scope
- Improving model quality for any provider.
- Stable release readiness claims.
- Hosted provider fleet management.
