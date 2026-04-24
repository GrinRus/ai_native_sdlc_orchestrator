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
- Routed live execution should surface explicit branch signatures: `success`, `missing-prerequisite`, and policy-blocked (`blocking_reasons` / unsupported-adapter) without mock-only fallthrough.
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
- missing-prerequisite and policy-blocked signatures remain explicit in standard runbook expectations; no silent mock-only fallback was observed.
- release-shaped rehearsal anchored `delivery-manifest.repo_deliveries[0].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the exercised target checkout.
- no-write safety defaults (`write_back_to_remote=false`) remained effective while still materializing delivery/release evidence.

Canonical fixture bundle:
- `examples/live-e2e/fixtures/w12-s04/w12-s04-evidence-bundle.json`

## W13-S06 refreshed curated full-journey proof bundle (2026-04-24)

Refreshed curated runs:
- `w13-s06.full-journey-regress-ky` status `pass` on mission `ky-header-regression`
- `w13-s06.full-journey-regress-httpie` status `pass` on mission `httpie-cli-output-regression`
- `w13-s06.full-journey-release-nextjs` status `pass` on mission `nextjs-shared-package-release`

Observed prerequisite confirmations:
- full-journey `project init` preserved target-specific verification commands through public repo command overrides instead of harness-side profile generation;
- `httpie/cli` bootstrap now uses `make install`, and its full-journey verification uses a bounded CLI pytest slice plus `make codestyle`;
- `nextjs-monorepo-example` full-journey verification uses monorepo `g:lint`, `g:typecheck`, and shared-package unit smoke instead of the broader `g:test-unit` matrix.

Observed artifact and closure guarantees:
- each run materialized mission-generated feature request, intake packet, discovery analysis, spec step-result, and handoff packet;
- review verdicts are backed by public `review-report`;
- closure is backed by public `audit runs` and `learning handoff`;
- release-shaped proof keeps `delivery-manifest` and `release-packet` anchored to the target checkout.

Canonical fixture bundle:
- `examples/live-e2e/fixtures/w13-s06/w13-s06-evidence-bundle.json`
