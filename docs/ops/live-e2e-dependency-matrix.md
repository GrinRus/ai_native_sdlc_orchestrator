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

- `live-e2e` runner executes `verification.setup_commands` first, then `verification.commands`, both in the cloned target workspace.
- Public-repo rehearsals keep `write_back_to_remote=false` by default.
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as external `inconclusive` for smoke tracking.
