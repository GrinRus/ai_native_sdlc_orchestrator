# W41 - post-alpha.8 installed-user validation and qualification refresh

Turn the `0.1.0-alpha.8` publication into the next bounded validation wave.
The wave starts from the installed registry package, verifies the no-settings
local UI path from a neutral runner, refreshes live E2E provider qualification
evidence through the standardized lifecycle, and turns any findings into scoped
fixes or follow-up backlog slices.

## Wave objective

An installed user should be able to install `@grinrus/aor@0.1.0-alpha.8`, open
`aor app`, complete or resume onboarding, and understand live E2E provider
status without reading internal repository notes. Maintainers should be able to
classify findings by owner and phase before deciding whether the next alpha needs
a code fix, docs fix, live E2E proof refresh, or backlog split.

## Wave exit criteria

- The post-alpha.8 backlog baseline is represented across the roadmap, master
  backlog, dependency graph, epic map, and this owning wave document.
- Installed-user smoke starts from the npm registry package in a neutral temp
  runner and proves help, app smoke, wizard markers, project switcher markers,
  flow selector markers, and no implicit runtime creation.
- Browser/UI validation covers the clean first-run path, existing-runtime resume
  path, local multi-project switching, readable error states, and first-flow
  handoff without adding hosted/SaaS scope.
- Live E2E qualification refresh uses the W39 provider-parity lifecycle and W40
  qualification matrix, separating AOR product failures, target repository
  blockers, provider failures, environment blockers, and operator decisions.
- Any discovered problem is either fixed inside a scoped slice with tests and
  evidence or split into a new backlog item with actionable acceptance criteria.
- The wave does not claim stable readiness, Docker/GHCR, hosted/SaaS, SDK
  release, mandatory Qwen/OpenCode/Claude qualification, or another npm release.

---

## W41-S01 — Post-alpha.8 backlog and validation baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Open W41 with source-of-truth backlog, roadmap, dependency, and traceability entries after the alpha.8 release.
- **Primary modules:** `docs/backlog/**`, `README.md`
- **Hard dependencies:** W40-S04
- **Primary user story surfaces:** no direct story closure; planning baseline for installed-user and live E2E post-release validation.

### Local tasks
1. Record the W41 wave goal, exit criteria, and out-of-scope boundaries.
2. Add W41 slices to the master backlog with one next ready validation slice.
3. Add W41 hard dependencies and topological order entries.
4. Add W41 roadmap summary and story allocation rows.
5. Update the epic map so W41 ownership is visible from EPIC-0, EPIC-1, EPIC-6, and EPIC-7.
6. Update README/backlog operating references so the latest wave source of truth points at W41.
7. Run `pnpm slice:status`, `pnpm slice:next -- --json`, and `pnpm slice:gate`.

### Acceptance criteria
1. Backlog tooling reports W41-S02 as the next ready slice.
2. The W41 baseline starts from the published alpha.8 package and does not claim a new npm release or stable readiness.
3. The next validation slice has enough context to run without reading this chat thread.
4. The dependency graph keeps W41 downstream from W40-S04 and does not reopen completed W35-W40 slices.

### Done evidence
- updated roadmap, master backlog, dependency graph, epic map, README pointer, and owning W41 wave doc
- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:gate`

### Out of scope
- Runtime, API, CLI, web, or live E2E code changes.
- Publishing another npm version.

---

## W41-S02 — Alpha.8 installed-user onboarding smoke refresh
- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Re-verify the published alpha.8 installed-user onboarding path and capture actionable UI/docs/code findings from the clean local app experience.
- **Primary modules:** `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W41-S01
- **Primary user story surfaces:** PBO-01, PBO-02, PBO-09, OPS-01, OPS-06, OPS-10.

### Local tasks
1. Run registry smoke from a neutral temp runner with `npm exec --package @grinrus/aor@0.1.0-alpha.8`.
2. Validate that `aor --help` and `aor app --smoke --open false --json` prove wizard, project switcher, flow selector, `New Flow`, and no implicit runtime creation.
3. Open the local UI in a browser and validate Project Context, Runtime Readiness, First Flow, and Next Action behavior on a clean temp repository.
4. Validate resume behavior for an initialized runtime and local multi-project switching without mixed flows, evidence refs, or runtime state.
5. Classify every finding by owner and phase: `aor`, `target_repository`, `provider`, `environment`, or `operator`; onboarding, runtime init, first flow, project switching, or evidence rendering.
6. Fix only tightly scoped AOR defects found in the smoke, with targeted tests; otherwise document findings and split follow-up backlog.
7. Run targeted tests, `pnpm web:build` if web changes are made, and `pnpm slice:gate`.

### Acceptance criteria
1. The published alpha.8 package is proven from the registry, not from the local checkout.
2. The clean UI path remains no-settings and explicit: `.aor/` is not created before Initialize Project Runtime.
3. The first-run wizard and multi-project switcher are understandable and clickable in browser validation.
4. Findings are owner/phase classified before any product failure or target/environment blocker conclusion is made.
5. Any code or docs change has focused tests or smoke evidence.

### Done evidence
- registry smoke command output
- browser/UI validation notes or screenshots
- finding classification table
- targeted test output
- slice gate output

### Out of scope
- Live provider qualification runs.
- Hosted workspace/SaaS behavior.
- Publishing another npm version.

---

## W41-S03 — Alpha.8 provider qualification smoke refresh
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Refresh Codex/Qwen/Claude/OpenCode qualification evidence through the provider-neutral live E2E lifecycle after installed-user onboarding smoke has passed or produced explicit blockers.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `docs/ops/**`, `docs/product/**`, tests
- **Hard dependencies:** W41-S02, W40-S04
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Start from the W40 provider qualification matrix and current auth/environment readiness.
2. Run short Codex live E2E smoke through the standard runner/profile lifecycle.
3. Run Qwen and other optional-provider smoke only where local credentials and environment allow; otherwise record explicit fail-closed blocker evidence.
4. Confirm no provider-specific lifecycle mode is used and no hidden internal repair starts after terminal provider result.
5. Verify UI/operator evidence includes provider status/progress, target setup/verification owner, failure phase, Runtime Harness report, routed step result, and adapter raw evidence.
6. Update qualification examples/runbooks with the refreshed evidence.
7. Run `pnpm live-e2e:test` and `pnpm slice:gate`.

### Acceptance criteria
1. Provider qualification uses W39 parity semantics for every provider tested.
2. Optional providers can be `qualified`, `candidate`, `blocked`, or `not-run` with readable owner/phase evidence.
3. Target repository or environment failures do not count as AOR product pass/fail or provider quality pass.
4. Qwen/OpenCode/Claude remain optional unless a future release policy changes their tier.
5. Every proof or blocker is traceable without opening private provider logs.

### Done evidence
- live E2E smoke refs or explicit blocker refs
- updated provider qualification matrix/runbook entries
- `pnpm live-e2e:test`
- slice gate output

### Out of scope
- Improving provider model quality.
- Reintroducing provider-specific lifecycle modes.
- Making optional providers release-blocking.

---

## W41-S04 — Alpha.8 findings closure and next-release decision
- **Epic:** EPIC-0 Repository development system; EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Convert W41 installed-user and provider-smoke findings into closed fixes or an explicit next-wave/release decision.
- **Primary modules:** `docs/backlog/**`, `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, tests
- **Hard dependencies:** W41-S02, W41-S03
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-10, OPS-11.

### Local tasks
1. Review W41-S02 and W41-S03 evidence against the W34-W40 target UI, UX, and live E2E architecture.
2. Separate true AOR defects from target repository, provider, environment, and operator blockers.
3. Implement only small scoped fixes that are already proven by W41 evidence.
4. Split larger findings into new backlog slices with owner, phase, acceptance criteria, and done evidence.
5. Decide whether an alpha.9 release prep slice is warranted; do not publish inside this slice.
6. Run targeted tests and `pnpm slice:gate`.

### Acceptance criteria
1. No W41 finding remains ambiguous about owner, phase, severity, or next action.
2. Scoped fixes, if any, are covered by tests and do not expand release scope.
3. Larger work is represented as ready/blocked backlog slices instead of chat-only notes.
4. The next-release recommendation is explicit: no release needed, release prep ready, or blocked by named evidence.

### Done evidence
- W41 findings closure table
- targeted test output for any fix
- updated backlog/runbook entries for follow-up slices
- slice gate output

### Out of scope
- Publishing npm alpha.9.
- Hosted/SaaS, Docker/GHCR, stable, or SDK release work.
