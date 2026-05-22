# Live E2E dependency matrix

This document is the source of truth for dependencies needed to run and test the canonical `live-e2e` profiles.

## AOR workspace baseline

Required for the control-plane workspace (`--project-ref`):
- `node >=22`
- `pnpm >=10`
- `git`

Repository gate commands:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm check
```

## Canonical profile matrix

| Profile | Required tools | setup_commands | verification.commands | External downloads | Typical failure signature |
| --- | --- | --- | --- | --- | --- |
| `regress-short` | `node >=22`, `npm`, `git`, Playwright runtime support | `npm install`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries | `xo: command not found` (dependencies not installed) or `browserType.launch: Executable doesn't exist` (Playwright browsers not installed) |
| `release-short` | `node >=22`, `npm`, `git`, Playwright runtime support | `npm install`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries | `xo: command not found` or Playwright browser executable missing |
| `w7-governance-integration` | `node >=22`, `npm`, `git`, Playwright runtime support | `npm install`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries | promotion/learning-loop linkage missing or release rehearsal path fails before closure evidence materialization |
| `full-journey-production-proof-ky-openai` | `node >=22`, `npm`, `git`, Playwright runtime support, authenticated `codex` CLI with non-interactive edit permissions | `npm install`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries + external runner auth/config | `not authenticated`, permission/readiness denial, missing `codex`, or blocking target verification failure before `run start` |
| `regress-long` | `python3`, `make`, `git` | `make install` | `make test`<br>`make codestyle` | Python dependencies from index/mirror | `No module named ...`, `make: *** ... Error` |
| `release-long` | `node`, `yarn`, `git` | `yarn install --immutable` | `yarn g:lint`<br>`yarn g:typecheck`<br>`yarn workspace @your-org/ts-utils test-unit`<br>`yarn workspace @your-org/core-lib test-unit` | Yarn workspace dependencies | `YN0000/YN...` install errors, workspace script failure |
| `commander-js` full-journey profiles | `node >=22`, `npm`, `git` | `npm ci` | `npm run test`<br>`npm run check` | npm packages | lockfile install errors, failing parser/help tests, or check script errors |
| `pluggy` full-journey profiles | `python3 >=3.9`, `pip`, `git` | `python3 -m venv .aor/live-e2e-venv`<br>`.aor/live-e2e-venv/bin/python -m pip install -e . "pytest>=8" pytest-benchmark coverage` | `.aor/live-e2e-venv/bin/python -m pytest testing` | Python dependencies from index/mirror | venv creation, editable install, or pytest failure |
| `cobra` extended target | `go`, `git` | `go mod download` | `go test ./...` | Go module downloads | module download or Go test failure |
| `date-fns` extended target | `node >=22`, `pnpm`, `git` | `pnpm install` | `pnpm vitest run`<br>`pnpm run lint`<br>`pnpm run types` | pnpm packages | Vitest, lint, or typecheck failure |

`pluggy` full-journey profiles require a full checkout with tags before editable
install. The target derives its version with `setuptools-scm`; shallow clones
report a pre-1.0 local version that conflicts with modern `pytest`.

## Notes

- Profiles declare `verification.setup_commands` and `verification.commands`; the internal `scripts/live-e2e/run-profile.mjs` proof runner executes them from a cloned target workspace as the canonical path.
- Standard run summaries should expose `target_checkout_root` and `generated_project_profile_file` so target-workspace provenance is machine-checkable.
- Routed live execution should surface explicit branch signatures: `success`, `missing-command`, `missing-live-runtime`, auth/permission blocks, and policy-blocked (`blocking_reasons` / unsupported-adapter) without mock-only fallthrough.
- Release-shaped runs should anchor `delivery-manifest.repo_deliveries[].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the same target checkout root.
- Public-repo rehearsals keep `write_back_to_remote=false` by default.
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as external `inconclusive` for smoke tracking.

## W25-S01 production-proof candidate profile

Canonical profile:
- `scripts/live-e2e/profiles/full-journey-production-proof-ky-openai.yaml`

Fail-closed prerequisites:
- profile resolves `target_catalog_id=ky` and `feature_mission_id=ky-header-regression`;
- packaged bootstrap assets are required; `--examples-root` is rejected for this profile;
- provider variant `openai-primary` must resolve to the packaged `codex-cli` external process adapter;
- runner auth probe, edit readiness, and permission readiness must pass before `run start`;
- `verification.baseline_gate.mode=blocking`, so target verification failure blocks before provider execution;
- `output_policy.write_back_to_remote=false` and `preferred_delivery_mode=patch-only`.
- post-run primary quality gates come from the curated mission and run `npx xo`, `npm run build`, and `npx ava test/headers.ts`; these are separate from baseline `verification.commands`.

Proof-mode fields:
- `production_proof.enabled=true`;
- `proof_scope=full_code_changing_runtime_candidate` before executable proof promotion;
- `external_runner_mode=real-external-process`;
- `real_code_change_proof_complete=false` until W25-S02 captures a real code-changing pass;
- promoted run summaries must record `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, passing required target verdicts, Runtime Harness/review/delivery evidence refs, and `no_upstream_write_assertion.status=pass`.
- the committed W25-S03 fixture lives at `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`; it is sanitized proof evidence for the `ky.regress.small.openai` production cell only, and proof integrity rejects mock-backed `full_code_changing_runtime` claims.

## W12-S04 refreshed short-profile proof bundle (2026-04-23)

Refreshed target-backed runs:
- `w12-s04.regress-short` (scenario `ky-regression-smoke`) status `pass`.
- `w12-s04.release-short` (scenario `ky-release-short`) status `pass`.

Observed prerequisite confirmations:
- both runs used real cloned target checkouts (`target_checkout_root`) instead of the AOR workspace.
- profile-driven `verification.setup_commands` and `verification.commands` ran through the standard preflight path.
- routed live execution emitted raw adapter evidence and compiled-context linkage on both runs.
- proof generation kept the installed-user black-box CLI flow and used a deterministic `--examples-root` override only for the adapter external runtime.

Observed failure signatures and safety defaults:
- missing-command, missing-live-runtime, auth/permission, and policy-blocked signatures remain explicit in standard runbook expectations; no silent mock-only fallback was observed.
- release-shaped rehearsal anchored `delivery-manifest.repo_deliveries[0].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the exercised target checkout.
- no-write safety defaults (`write_back_to_remote=false`) remained effective while still materializing delivery/release evidence.

Canonical fixture bundle:
- `examples/live-e2e/fixtures/w12-s04/w12-s04-evidence-bundle.json`

## W14 scenario/provider/size matrix notes (2026-04-24)

Mandatory matrix axes:
- `scenario_family`: `regress`, `release`, `repair`, `governance`
- `provider_variant_id`: `openai-primary`, `anthropic-primary`, `open-code-primary`
- `feature_size`: `small`, `medium`, `large`, with `xl` reserved for manual/overnight profiles
- `run_tier`: `readme-smoke`, `bounded-live`, `full-journey-observation`, `acceptance`, `production-proof`

Operational rules:
- one live run proves exactly one pinned provider path;
- each curated repo must expose `small`, `medium`, and `large` missions in its target catalog;
- review and learning closure artifacts must carry `matrix_cell` and `coverage_follow_up`;
- provider comparison coverage is required between `openai-primary` and `anthropic-primary` for at least one equivalent mission class per curated repo.
- `openai-primary` and `anthropic-primary` are mandatory provider variants across comparison coverage; `open-code-primary` is extended candidate coverage until a future real-runner proof promotes it.
- required matrix coverage closes only for `coverage_status=covered_pass` on `run_tier=acceptance` or `run_tier=production-proof`; warning runs remain `covered_with_findings`.

## W14-S07 refreshed matrix full-journey proof bundle (2026-04-24)

Refreshed curated runs:
- `ky` required cells: `w14-s07.full-journey-regress-ky`, `w14-s07.full-journey-regress-ky-medium-anthropic-rerun`, `w14-s07.full-journey-release-ky-medium-openai`
- `ky` provider comparison pair: `w14-s07.full-journey-regress-ky` and `w14-s07.full-journey-regress-ky-anthropic`
- `httpie/cli` required cells: `w14-s07.full-journey-regress-httpie`, `w14-s07.full-journey-repair-httpie-medium-anthropic`, `w14-s07.full-journey-governance-httpie-medium-openai`
- `httpie/cli` provider comparison pair: `w14-s07.full-journey-regress-httpie` and `w14-s07.full-journey-regress-httpie-anthropic`
- `nextjs-monorepo-example` required cells: `w14-s07.full-journey-release-nextjs`, `w14-s07.full-journey-repair-nextjs-medium-anthropic`, `w14-s07.full-journey-governance-nextjs-large-openai`
- `nextjs-monorepo-example` provider comparison pair: `w14-s07.full-journey-release-nextjs` and `w14-s07.full-journey-release-nextjs-anthropic`

Observed prerequisite confirmations:
- full-journey `project init` preserved target-specific verification commands through public repo command overrides instead of proof-runner-side profile generation;
- provider-pinned route overrides were materialized for both `codex-cli` and `claude-code` matrix cells;
- `httpie/cli` bootstrap used `make install`, and its full-journey verification used a bounded CLI pytest slice plus `make codestyle`;
- `nextjs-monorepo-example` full-journey verification used monorepo `g:lint`, `g:typecheck`, and shared-package unit smoke instead of the broader `g:test-unit` matrix.

Observed artifact and closure guarantees:
- each run materialized mission-generated feature request, intake packet, discovery analysis, spec step-result, and handoff packet;
- review verdicts are backed by public `review-report` with `provider_traceability` and `feature_size_fit`;
- closure is backed by public `audit runs` and `learning handoff`;
- release-shaped proof keeps `delivery-manifest` and `release-packet` anchored to the target checkout;
- the committed bundle exercises all `9/9` required matrix cells, all `3/3` catalog provider-comparison pairs, and all mandatory scenario families, but is historical `coverage_with_findings` evidence under the canonical status model. Required acceptance closure needs a current `covered_pass` run on `run_tier=acceptance` or `run_tier=production-proof`.

Canonical fixture bundle:
- `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json`
