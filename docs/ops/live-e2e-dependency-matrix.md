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

- Profiles declare `verification.setup_commands` and `verification.commands`; W11 tracks making the standard `live-e2e` runner execute them from a cloned target workspace as the canonical path.
- Standard run summaries should expose `target_checkout_root` and `generated_project_profile_file` so target-workspace provenance is machine-checkable.
- Routed live execution should surface explicit branch signatures: `success`, `missing-prerequisite`, and policy-blocked (`blocking_reasons` / unsupported-adapter) without mock-only fallthrough.
- Release-shaped runs should anchor `delivery-manifest.repo_deliveries[].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the same target checkout root.
- Public-repo rehearsals keep `write_back_to_remote=false` by default.
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as external `inconclusive` for smoke tracking.

## W10-S05 observed baseline runs pending W11 closure (2026-04-23)

Observed with current external short-profile runs:
- `live-e2e.regress.short.run-423122617518` (scenario `ky-regression-smoke`) status `pass`.
- `live-e2e.release.short.run-423122830183` (scenario `ky-release-short`) status `pass`.

Observed prerequisite confirmations:
- `npm install` and `npx playwright install` completed successfully for both short profiles.
- `npm test` completed successfully for both short profiles.
- detached external adapter invocation path remained available throughout execution stages.

Observed failure signatures and safety defaults:
- no blocking failure signature was observed in these two runs; catalog defaults remain unchanged.
- release-shaped rehearsal produced `patch-only` delivery artifacts and did not require upstream write-back.
- no-write safety defaults (`write_back_to_remote=false`) remained effective while still materializing delivery/release evidence.

Evidence fixture bundle:
- `examples/live-e2e/fixtures/w10-s05/w10-s05-evidence-bundle.json`

Closure note:
- `W10-S05` remains blocked because the current bundle does not yet prove target-backed checkout, execution-root, and delivery-path anchoring end to end.
