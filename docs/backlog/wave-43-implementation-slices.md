# W43 - post-alpha.10 installed-user and live E2E confidence refresh

W43 follows the `0.1.0-alpha.10` release. Alpha.10 published the W42-S02
operator-owned provider interruption classification, so the next work is
installed-user and live E2E confidence validation from the registry package
rather than new product scope.

## Wave objective

Maintainers should prove that the published alpha.10 package still gives a clean
installed-user first run and that live E2E interruption/provider evidence is
readable through public surfaces. Any finding must be classified by owner and
phase, then fixed in a scoped slice or split into follow-up backlog before a
next release decision.

## Wave exit criteria

- `@grinrus/aor@0.1.0-alpha.10` registry smoke is rerun from a neutral temp
  runner and proves help, packaged app smoke, first-run wizard, project switcher,
  flow selector, `New Flow`, and no implicit `.aor/` creation.
- Browser/UI validation covers clean first-run onboarding, initialized-runtime
  resume, local multi-project switching, readable evidence/error states, and
  first-flow handoff.
- Live E2E smoke validates operator-owned provider interruption evidence through
  reports/UI without hiding provider, target repository, environment, or AOR
  failures.
- Optional Qwen, OpenCode, and Claude coverage remains non-release-blocking
  unless a future release-policy slice explicitly changes that rule.
- Every finding is classified as fixed, documented blocker, split to backlog, no
  release needed, or release prep needed.

---

## W43-S01 — Post-alpha.10 backlog and confidence baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Open W43 with source-of-truth backlog, roadmap, dependency, epic,
  and story-traceability entries after the alpha.10 release.
- **Primary modules:** `docs/backlog/**`, `README.md`
- **Hard dependencies:** W42-S02
- **Primary user story surfaces:** no direct story closure; validation and
  traceability baseline for post-alpha.10 confidence work.

### Local tasks
1. Record the W43 wave goal, exit criteria, and out-of-scope boundaries.
2. Add W43 slices to the master backlog with one next ready validation slice.
3. Add W43 hard dependencies and topological order entries.
4. Add W43 roadmap summary and story allocation rows.
5. Update the epic map and README latest-wave pointers.
6. Verify slice tooling chooses W43-S02 as the next ready slice.

### Acceptance criteria
1. Backlog tooling reports W43-S02 as the next ready slice.
2. W43 starts from the published alpha.10 package and does not claim stable
   readiness, Docker/GHCR, hosted/SaaS, SDK release, or mandatory optional
   provider qualification.
3. W43 dependencies stay downstream of W42-S02 and do not reopen completed
   W34-W42 slices.

### Done evidence
- updated roadmap, master backlog, dependency graph, epic map, README pointer,
  and owning W43 wave doc
- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:plan -- W43-S02`
- `pnpm slice:gate`

### Closure evidence — 2026-06-04
- W43 source-of-truth backlog entries were added after
  `@grinrus/aor@0.1.0-alpha.10` was published and registry-smoked.
- W43-S02 is the only ready slice; W43-S03 and W43-S04 remain dependency-blocked.

### Out of scope
- Running W43-S02 installed-user smoke.
- Changing runtime/API/web behavior.
- Publishing another npm version.

---

## W43-S02 — Alpha.10 installed-user onboarding and evidence smoke
- **Epic:** EPIC-1 Bootstrap and onboarding; EPIC-6 Operator surface
- **State:** done
- **Outcome:** Validate the published alpha.10 package from an installed-user
  perspective and capture any onboarding/evidence readability findings with
  owner and phase.
- **Primary modules:** `README.md`, `docs/ops/**`, `apps/cli/**`,
  `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W43-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-06, OPS-10.

### Local tasks
1. Run registry smoke from a neutral temp runner with
   `@grinrus/aor@0.1.0-alpha.10`; accept only `status=smoke-pass` and no
   implicit clean-target `.aor/` creation.
2. Launch the packaged UI and manually validate Project Context, Runtime
   Readiness, First Flow, Next Action, existing-runtime resume, and two-project
   switching.
3. Check that evidence, blockers, runtime roots, and errors render as readable
   summaries before raw refs/debug actions.
4. Record findings in the installed-user runbook or W43 evidence notes with
   `failure_owner` and `failure_phase`.
5. Fix only small AOR defects with targeted tests; split larger findings to
   backlog.

### Acceptance criteria
1. Published-package CLI help and app smoke pass from outside the source checkout.
2. Clean UI launch does not initialize runtime until the user explicitly starts
   initialization.
3. Multi-project switching does not mix selected flow, evidence refs, operator
   requests, blockers, or runtime state.
4. Findings are actionable and owner/phase classified.

### Done evidence
- registry smoke JSON
- browser/UI smoke notes or screenshots
- targeted test output for any fix
- `pnpm web:build` if UI changes
- `pnpm slice:gate`

### Out of scope
- Live E2E provider qualification smoke.
- Release publication.
- Hosted/SaaS or automatic filesystem scanning behavior.

---

## W43-S03 — Alpha.10 live E2E interruption and provider smoke
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Validate W42-S02 interruption ownership and provider-parity
  behavior through normal live E2E smoke after installed-user confidence checks.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`,
  `docs/ops/**`, `apps/web/**`, tests
- **Hard dependencies:** W43-S02
- **Primary user story surfaces:** DEV-04, AIP-12, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Run `pnpm live-e2e:test` before provider smoke.
2. Run one short Codex live E2E smoke through the normal profile lifecycle.
3. Run Qwen, Claude, or OpenCode smoke only when local auth/environment is ready;
   otherwise record explicit fail-closed blocker evidence.
4. Verify terminal provider results preserve routed step result, adapter raw
   evidence, Runtime Harness report, provider status/progress, and no hidden
   internal repair.
5. Verify operator stops classify as `failure_owner=operator`,
   `failure_phase=provider_execution`, and `failure_class=operator_stopped`
   without masking provider/target/environment/AOR failures.

### Acceptance criteria
1. Codex smoke either reaches a clean proof point or fails closed with readable
   owner/phase evidence.
2. Optional provider smoke does not become release-blocking without explicit
   release-policy change.
3. Operator-owned interruption evidence is readable in reports/UI without raw
   JSON inspection.
4. Target repository failures are separated from AOR project failures.

### Done evidence
- live E2E smoke refs or blocker report
- provider qualification matrix/runbook update if evidence changes
- targeted tests for any fix
- `pnpm live-e2e:test`
- `pnpm slice:gate`

### Out of scope
- Promoting optional providers to release-blocking status.
- Adding provider-specific lifecycle modes.
- Publishing another npm version.

---

## W43-S04 — Alpha.10 findings closure and next-release decision
- **Epic:** EPIC-0 Repository development system; EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Convert W43 installed-user and live E2E findings into scoped
  fixes, documented blockers, split backlog, or a next-release decision.
- **Primary modules:** `docs/backlog/**`, `README.md`, `docs/ops/**`, tests
- **Hard dependencies:** W43-S02, W43-S03
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-10, OPS-11.

### Local tasks
1. Review W43-S02 and W43-S03 evidence against W34-W42 UI/UX and live E2E
   architecture.
2. Classify each finding as fixed, documented blocker, split to backlog, no
   release needed, or release prep needed.
3. Implement only small scoped fixes that are already proven by W43 evidence.
4. If another alpha is needed, create a separate release-prep slice; do not
   publish inside W43-S04.
5. Sync backlog state and leave exactly one next action visible.

### Acceptance criteria
1. No W43 finding remains ambiguous about owner, phase, severity, or next action.
2. Release-needed findings are not hidden inside validation slices.
3. Optional provider gaps remain separate from required installed-user
   confidence gates.

### Done evidence
- W43 findings closure table
- backlog/source-of-truth updates
- targeted tests for any fix
- `pnpm slice:status`
- `pnpm slice:gate`

### Out of scope
- Publishing a release inside W43-S04.
- Hiding release-needed fixes inside validation closure.
- Changing optional provider release policy without a dedicated slice.
