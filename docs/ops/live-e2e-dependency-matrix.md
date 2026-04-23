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
| `regress-long` | `python`, `pip`, `make`, `git` | `python -m pip install -e ".[dev]"` | `make test`<br>`make codestyle` | Python dependencies from index/mirror | `No module named ...`, `make: *** ... Error` |
| `release-long` | `node`, `corepack`, `yarn`, `git` | `yarn install --immutable` | `yarn g:lint`<br>`yarn g:typecheck`<br>`yarn g:test-unit` | Yarn workspace dependencies | `YN0000/YN...` install errors, workspace script failure |

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
