# Live E2E dependency matrix

This document is the source of truth for dependencies needed to run and test the canonical `live-e2e` profiles.

## AOR workspace baseline

Required for the control-plane workspace (`--project-ref`):
- `node >=22`
- `pnpm >=10`
- `git`

Repository gate commands:

```bash
pnpm install
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
| `regress-long` | `python3`, `make`, `git` | `make install` | `make test`<br>`make codestyle` | Python dependencies from index/mirror | `No module named ...`, `make: *** ... Error` |
| `release-long` | `node`, `yarn`, `git` | `yarn install --immutable` | `yarn g:lint`<br>`yarn g:typecheck`<br>`yarn workspace @your-org/ts-utils test-unit`<br>`yarn workspace @your-org/core-lib test-unit` | Yarn workspace dependencies | `YN0000/YN...` install errors, workspace script failure |

## Notes

- Profiles declare `verification.setup_commands` and `verification.commands`; the internal `scripts/live-e2e/run-profile.mjs` harness executes them from a cloned target workspace as the canonical path.
- Standard run summaries should expose `target_checkout_root` and `generated_project_profile_file` so target-workspace provenance is machine-checkable.
- Routed live execution should surface explicit branch signatures: `success`, `missing-command`, `missing-live-runtime`, auth/permission blocks, and policy-blocked (`blocking_reasons` / unsupported-adapter) without mock-only fallthrough.
- Release-shaped runs should anchor `delivery-manifest.repo_deliveries[].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the same target checkout root.
- Public-repo rehearsals keep `write_back_to_remote=false` by default.
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as external `inconclusive` for smoke tracking.

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
- `feature_size`: `small`, `medium`, `large`

Operational rules:
- one live run proves exactly one pinned provider path;
- each curated repo must expose `small`, `medium`, and `large` missions in its target catalog;
- review and learning closure artifacts must carry `matrix_cell` and `coverage_follow_up`;
- provider comparison coverage is required between `openai-primary` and `anthropic-primary` for at least one equivalent mission class per curated repo.
- `openai-primary` and `anthropic-primary` are mandatory provider variants; `open-code-primary` remains extended coverage.

## W14-S07 refreshed matrix full-journey proof bundle (2026-04-24)

Refreshed curated runs:
- `ky` required cells: `w14-s07.full-journey-regress-ky`, `w14-s07.full-journey-regress-ky-medium-anthropic-rerun`, `w14-s07.full-journey-release-ky-medium-openai`
- `ky` provider comparison pair: `w14-s07.full-journey-regress-ky` and `w14-s07.full-journey-regress-ky-anthropic`
- `httpie/cli` required cells: `w14-s07.full-journey-regress-httpie`, `w14-s07.full-journey-repair-httpie-medium-anthropic`, `w14-s07.full-journey-governance-httpie-medium-openai`
- `httpie/cli` provider comparison pair: `w14-s07.full-journey-regress-httpie` and `w14-s07.full-journey-regress-httpie-anthropic`
- `nextjs-monorepo-example` required cells: `w14-s07.full-journey-release-nextjs`, `w14-s07.full-journey-repair-nextjs-medium-anthropic`, `w14-s07.full-journey-governance-nextjs-large-openai`
- `nextjs-monorepo-example` provider comparison pair: `w14-s07.full-journey-release-nextjs` and `w14-s07.full-journey-release-nextjs-anthropic`

Observed prerequisite confirmations:
- full-journey `project init` preserved target-specific verification commands through public repo command overrides instead of harness-side profile generation;
- provider-pinned route overrides were materialized for both `codex-cli` and `claude-code` matrix cells;
- `httpie/cli` bootstrap used `make install`, and its full-journey verification used a bounded CLI pytest slice plus `make codestyle`;
- `nextjs-monorepo-example` full-journey verification used monorepo `g:lint`, `g:typecheck`, and shared-package unit smoke instead of the broader `g:test-unit` matrix.

Observed artifact and closure guarantees:
- each run materialized mission-generated feature request, intake packet, discovery analysis, spec step-result, and handoff packet;
- review verdicts are backed by public `review-report` with `provider_traceability` and `feature_size_fit`;
- closure is backed by public `audit runs` and `learning handoff`;
- release-shaped proof keeps `delivery-manifest` and `release-packet` anchored to the target checkout;
- the committed bundle proves all `9/9` required matrix cells, all `3/3` catalog provider-comparison pairs, and all mandatory scenario families.

Canonical fixture bundle:
- `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json`
