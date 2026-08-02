# W42 - alpha.9 release and operator interruption classification follow-up

W42 is the follow-up wave created by W41-S04. W41 proved that the published
`0.1.0-alpha.8` package works for clean no-settings onboarding, but it also
found a user-facing evidence-rendering defect that was fixed after the alpha.8
publication. W42 first packages that fix as the next npm alpha, then addresses
the remaining live E2E classification finding without holding the release.

## Wave objective

Installed users should receive the W41 evidence-rendering fix through the npm
alpha channel. Maintainers should then make operator-initiated live E2E provider
stops clearer in owner/phase summaries without changing provider parity,
target-repository separation, or optional provider release policy.

## Wave exit criteria

- `@grinrus/aor@0.1.0-alpha.9` release prep is represented as the next ready
  slice after W41-S04.
- Release notes claim only already-merged W41 user-facing fixes/docs and do not
  claim stable readiness, Docker/GHCR, SDK, hosted/SaaS, or required optional
  provider qualification.
- Operator-initiated provider interruption ownership is handled in its own
  contract-first slice, with owner/phase acceptance criteria and tests.
- Optional Qwen/OpenCode/Claude qualification remains non-release-blocking unless
  a future release policy explicitly changes it.

---

## W42-S01 — Alpha.9 release prep for W41 fixes
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Prepare and publish the npm alpha release that carries the
  post-alpha.8 installed-user evidence-rendering fix and W41 docs updates.
- **Primary modules:** `package.json`, `README.md`, `CHANGELOG.md`,
  `docs/ops/**`, release tests
- **Hard dependencies:** W41-S04
- **Primary user story surfaces:** no direct story closure; release packaging
  for already-merged installed-user/operator fixes.

### Local tasks
1. Verify npm registry state and choose the next immutable alpha version
   (`0.1.0-alpha.9` if `0.1.0-alpha.8` is still the current alpha).
2. Create a release branch from fresh `origin/main`.
3. Update `package.json`, README install examples, and `CHANGELOG.md` for the chosen alpha version.
4. Changelog scope must be limited to W41 installed-user evidence-rendering fix, W41 alpha.8 smoke findings closure, and provider qualification docs/matrix refresh.
5. Run strict `pnpm release:gate`.
6. Open a release PR with the publish label and merge only after required CI is green.
7. Verify GitHub Trusted Publishing, npm `alpha` dist-tag, git tag, and prerelease GitHub Release.
8. Run installed-user smoke from the published registry package.

### Acceptance criteria
1. Release branch contains only release metadata/docs/release-prep fixes.
2. `latest` is not moved; `alpha` points at the new alpha after publish.
3. The release does not claim stable readiness or optional-provider qualification beyond documented evidence.
4. Post-publish smoke proves the packaged app no longer shows valid runtime sidecar refs as missing evidence.

### Done evidence
- release gate output
- release PR CI output
- npm/tag/GitHub Release verification
- installed-user registry smoke output

### Closure evidence — 2026-06-04
- Release branch `release/v0.1.0-alpha.9` contained release metadata,
  release docs, changelog, and release-prep guardrail fixture updates only.
- Local strict release gate passed with
  `AOR_RELEASE_BRANCH=release/v0.1.0-alpha.9 AOR_RELEASE_STRICT_BRANCH=true pnpm release:gate`.
- Release PR [#69](https://github.com/GrinRus/ai_native_sdlc_orchestrator/pull/69)
  passed Repo integrity, CodeQL, Dependency Review, OpenSSF Scorecard, and
  Release candidate gate before merge.
- GitHub Trusted Publishing completed successfully for
  `@grinrus/aor@0.1.0-alpha.9`; npm `alpha` points at `0.1.0-alpha.9`,
  npm `latest` remains `0.1.0-alpha.1`, git tag `v0.1.0-alpha.9` exists,
  and the GitHub Release is marked prerelease.
- Installed-user registry smoke from a neutral temp runner returned
  `status=smoke-pass` with `flow_selector_loaded`,
  `new_flow_action_loaded`, `first_run_wizard_loaded`, and
  `project_switcher_loaded`, and it did not create the clean target `.aor/`
  before explicit initialization.

### Out of scope
- Operator interruption owner classification changes.
- New runtime/API contract fields.
- Docker/GHCR/stable/latest/SDK release.

---

## W42-S02 — Operator interruption owner classification cleanup
- **Epic:** EPIC-6 Operator surface; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make public operator-initiated provider stops explicit in live E2E
  summaries, UI evidence, and qualification records without masking provider,
  target repository, environment, or AOR failures.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core/**`,
  `scripts/live-e2e/**`, `apps/web/**`, `docs/ops/**`, tests
- **Hard dependencies:** W42-S01
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-11.

### Local tasks
1. Contract-first decide whether operator-initiated public cancel should set `failure_owner=operator`, add an explicit interruption reason field, or keep `failure_owner=provider` while exposing `operator-stopped` as first-class context.
2. Preserve the current fail-closed behavior: interrupted provider execution is never a pass and must still keep Runtime Harness `block` evidence.
3. Update run summaries, observation reports, provider qualification matrix generation, and web execution evidence rendering consistently.
4. Add regression coverage for provider crash/interruption, operator cancel, timeout, environment blocker, target setup blocker, and target verification blocker separation.
5. Refresh live E2E docs with examples from the W41 Codex/Qwen smoke findings.

### Acceptance criteria
1. Operator-initiated stop is readable without inspecting raw run-control JSON.
2. Provider failures and operator stops are distinguishable in owner/phase summaries or equivalent public fields.
3. Existing W35/W40 fail-closed fixtures are migrated deliberately or preserved with compatibility notes.
4. No provider-specific lifecycle mode is introduced.

### Done evidence
- contract/docs/example updates
- targeted unit/integration/web tests
- `pnpm live-e2e:test`
- `pnpm slice:gate`

### Closure evidence — 2026-06-04
- Contract docs and OpenAPI now expose optional
  `provider_step_status.interruption_owner`, `interruption_status`, and
  sanitized `interruption_reason`; execution evidence also exposes
  `provider_interruption_owner`, `provider_interruption_status`, and
  `provider_interruption_reason`.
- Public `aor run cancel` and adapter-supervised external runner interruption
  preserve `interruption_owner=operator` and `interruption_status=operator-stopped`
  while keeping provider execution `interrupted` and fail-closed.
- Live E2E report hydration and provider qualification matrix generation now
  classify operator timebox stops as `failure_owner=operator`,
  `failure_phase=provider_execution`, and `failure_class=operator_stopped`;
  provider failures/timeouts, target repository blockers, environment blockers,
  and AOR failures remain separate owner/phase outcomes.
- Web execution evidence renders interruption owner/status rows and operator
  stop copy without requiring raw run-control JSON inspection.
- Targeted validation passed:
  provider status/runtime tests, execution evidence tests, adapter SDK tests,
  web source tests, `pnpm test:references`, `pnpm live-e2e:test`,
  `pnpm web:build`, and `pnpm slice:gate`.

### Out of scope
- Improving provider model quality.
- Making optional providers release-blocking.
- Publishing another npm version inside this slice.
