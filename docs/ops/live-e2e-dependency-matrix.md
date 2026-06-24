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
| `full-journey-production-proof-ky-openai` | `node >=22`, `npm`, `git`, Playwright runtime support, authenticated `codex` CLI with non-interactive edit permissions | `npm install --prefer-offline --no-audit --no-fund`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries + external runner auth/config | `not authenticated`, permission/readiness denial, missing `codex`, or blocking target verification failure before `run start` |
| `commander-js` full-journey profiles | `node >=22`, `npm`, `git` | `npm ci` | `npm run test`<br>`npm run check` | npm packages | lockfile install errors, failing parser/help tests, or check script errors |
| `pluggy` full-journey profiles | `python3 >=3.9`, `pip`, `git` | `python3 -m venv .aor/live-e2e-venv`<br>`.aor/live-e2e-venv/bin/python -m pip install -e . "pytest>=8" pytest-benchmark coverage` | `.aor/live-e2e-venv/bin/python -m pytest testing` | Python dependencies from index/mirror | venv creation, editable install, or pytest failure |
| `zod` extended target | `node >=22`, `pnpm`, `git` | `pnpm install` | `pnpm run build`<br>`pnpm test`<br>`pnpm run lint:check` | pnpm packages | workspace install, Vitest, build, or Biome lint failure |
| `httpx` extended target | `python3 >=3.9`, `pip`, `git` | `python3 -m venv .aor/live-e2e-venv`<br>`.aor/live-e2e-venv/bin/python -m pip install -U pip`<br>`.aor/live-e2e-venv/bin/python -m pip install -r requirements.txt` | `./scripts/sync-version`<br>`.aor/live-e2e-venv/bin/python -m pytest tests/test_timeouts.py`<br>`.aor/live-e2e-venv/bin/ruff check httpx tests`<br>`.aor/live-e2e-venv/bin/mypy httpx tests` | Python dependencies from index/mirror | venv creation, requirements install, sync-version, targeted pytest, Ruff, or mypy failure |
| `eslint` extended target | `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`, `npm`, `git` | `npm install` | `npm run test:cli`<br>`npm run lint:rule-types`<br>`npm run lint:types` | npm packages | dependency install, Mocha rule tests, rule metadata, or type-package lint failure |
| `fastify` extended target | `node >=22`, `npm`, `git` | `npm install` | `npm run test:ci`<br>`npm run lint` | npm packages | dependency install, unit/type tests, or ESLint failure |
| `prettier` extended target | `node >=22`, `yarn >=4`, `git` | `yarn install --immutable` | `yarn lint:typecheck`<br>`yarn lint:eslint`<br>`yarn test tests/format/typescript tests/format/markdown` | Yarn packages | immutable install, TypeScript, ESLint, or focused snapshot test failure |
| `ruff` extended target | `rust/cargo`, `git` | `cargo fetch` | `cargo test -p ruff_linter`<br>`cargo test -p ruff_python_formatter` | Cargo crate downloads | cargo fetch, Rust compile, targeted crate test, or snapshot-related failure |
| `vitest` hard target | `node >=22`, `pnpm`, `git` | `pnpm install --frozen-lockfile` | `pnpm test`<br>`pnpm lint` | pnpm packages | monorepo install, runner diagnostics tests, lint, or typecheck failure |
| `sqlalchemy` hard target | `python3 >=3.9`, `pip`, `git` | `python3 -m venv .aor/live-e2e-venv`<br>`.aor/live-e2e-venv/bin/python -m pip install -U pip`<br>`.aor/live-e2e-venv/bin/python -m pip install -e .[test]` | `.aor/live-e2e-venv/bin/python -m pytest test/sql test/orm` | Python dependencies from index/mirror | venv creation, editable install, SQL/ORM pytest failure |
| `biome` hard target | `node >=22`, `pnpm`, `git` | `pnpm install --frozen-lockfile` | `pnpm test`<br>`pnpm lint` | pnpm packages + Rust/Cargo through workspace scripts when invoked | workspace install, rule/formatter snapshot failure, lint, or typecheck failure |
| `ky` bounded full-journey profiles | `node >=22`, `npm`, `git`, authenticated provider CLI (`codex` for `openai-primary`, Claude Code for `anthropic-primary`, `opencode` for `open-code-primary`, `qwen` for `qwen-primary`; Qwen host auth may require the `ANTHROPIC_AUTH_TOKEN -> ANTHROPIC_API_KEY` adapter alias) | profile-bounded `npm install --prefer-offline --no-audit --no-fund`; diagnostic full-suite runs `npx playwright install` before `npm test` | small: `npx xo`<br>`npm run build`<br>`npx ava test/headers.ts`; medium regress: `npx xo`<br>`npm run build`<br>`npx ava test/retry.ts --match='*shouldRetry*'`; release: `npx xo`<br>`npm run build`<br>`npx ava test/hooks.ts`; large governance: `npx xo`<br>`npm run build`<br>`npx ava test/main.ts test/hooks.ts`<br>`npx ava test/retry.ts --match='*shouldRetry*'` | npm packages + Playwright browser binaries for diagnostic full-suite + provider auth/config | missing provider CLI/auth, permission/readiness denial, provider timeout, target setup/verification blocker with `failure_owner=target_repository`, AOR runner blocker with `failure_owner=aor`, or no-upstream-write violation |
| `installed-user-guided-journey` | `node >=22`, `npm`, `git`, authenticated `codex` CLI, local web runtime support | target catalog commands for `ky` plus `aor app --smoke --open false --json` | target catalog commands plus guided flow-loop and web task proof | npm packages + Playwright browser binaries when the target commands require them | missing auth/permission readiness, failed target verification, missing first/second flow evidence, missing flow-targeted request evidence, missing web HTML/DOM/accessibility/screenshot-or-visual evidence, or missing post-run AOR operator UI/UX assessment evidence when that quality is claimed |
| `installed-user-guided-journey-qwen` | `node >=22`, `npm`, `git`, authenticated `qwen` CLI with the same auth env alias when needed, local web runtime support | target catalog commands for `ky` plus `aor app --smoke --open false --json` | target catalog commands plus guided flow-loop and web task proof | npm packages + Playwright browser binaries when the target commands require them + Qwen auth/config | missing qwen CLI/auth, path-length-sensitive runtime setup, provider timeout, failed target verification, missing browser-task proof, or missing post-run AOR operator UI/UX assessment evidence when that quality is claimed |

`pluggy` full-journey profiles require a full checkout with tags before editable
install. The target derives its version with `setuptools-scm`; shallow clones
report a pre-1.0 local version that conflicts with modern `pytest`.

## Notes

- Supported live proof profiles are full-journey/catalog-backed profiles and `installed-user-guided-journey`. Removed bounded deterministic profiles such as `regress-short`, `release-short`, `regress-long`, `release-long`, and `w7-governance-integration` are not current live E2E acceptance commands.
- Profiles declare `verification.setup_commands` and `verification.commands`; the internal `scripts/live-e2e/run-profile.mjs` proof runner executes them from a cloned target workspace as the canonical path.
- Standard run summaries should expose `target_checkout_root` and `generated_project_profile_file` so target-workspace provenance is machine-checkable.
- Routed live execution should surface explicit branch signatures: `success`, `missing-command`, `missing-live-runtime`, auth/permission blocks, and policy-blocked (`blocking_reasons` / unsupported-adapter) without mock-only fallthrough.
- Release-shaped runs should anchor `delivery-manifest.repo_deliveries[].repo_root` and `release-packet.source_provenance.delivery_execution_root` to the same target checkout root.
- Public-repo rehearsals keep `write_back_to_remote=false` by default.
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as a fail-closed target/environment blocker with owner/phase evidence; do not report it as provider quality or AOR product success.
- New extended candidate targets are runnable catalog-backed profiles, but do not
  close required matrix acceptance until their baseline setup, provider execution,
  post-run verification, and no-upstream-write evidence are promoted by a
  passing acceptance or production-proof run.

## W25-S01 production-proof candidate profile

Canonical profile:
- `scripts/live-e2e/profiles/full-journey-production-proof-ky-openai.yaml`

Fail-closed prerequisites:
- profile resolves `target_catalog_id=ky` and `feature_mission_id=ky-header-regression`;
- packaged bootstrap assets are required; no bootstrap asset override flag is supported;
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
- promoted run summaries must record `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, materialized Runtime Harness/review/delivery evidence refs, and `no_upstream_write_assertion.status=pass`.
- the committed W25-S03 fixture lives at `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`; it is sanitized proof evidence for the `ky.regress.small.openai` production cell only, and proof integrity rejects mock-backed `full_code_changing_runtime` claims.

## Removed bounded fixture bundles

The legacy W7/W10/W11/W12 bounded rehearsal bundles were removed from the repository when live E2E moved to skill-agent-only proof. Those artifacts predate the current acceptance model, did not require accepted `operator_decision_ref` evidence for every included step, and must not be cited as live acceptance closure. Historical backlog rows may still describe why those waves existed, but current live proof evidence starts at catalog-backed full journeys, `installed-user-guided-journey`, and the W25 production-proof fixture.

## W14 scenario/provider/size matrix notes (2026-04-24)

Mandatory matrix axes:
- `scenario_family`: `regress`, `release`, `repair`, `governance`
- `provider_variant_id`: `openai-primary`, `anthropic-primary`, `open-code-primary`, `qwen-primary`
- `feature_size`: `small`, `medium`, `large`, with `xlarge` reserved for manual/overnight profiles. `xl` is rejected.
- `run_tier`: `readme-smoke`, `bounded-live`, `full-journey-observation`, `acceptance`, `production-proof`

Operational rules:
- one live run proves exactly one pinned provider path;
- each curated repo must expose `small`, `medium`, and `large` missions in its target catalog;
- review and learning closure artifacts must carry `matrix_cell` and `coverage_follow_up`;
- provider comparison coverage is required between `openai-primary` and `anthropic-primary` for at least one equivalent mission class per curated repo.
- `openai-primary` and `anthropic-primary` are mandatory provider variants across comparison coverage; `open-code-primary` and `qwen-primary` are extended candidate coverage until future real-runner proof promotes them.
- `qwen-primary` remains extended candidate coverage; timeout or provider-progress evidence is an adapter finding, while target setup/verification, Runtime Harness retry/repair, and operator evidence semantics remain provider-neutral across Codex, Claude, OpenCode, and Qwen.
- required matrix coverage closes only for `run_tier=acceptance` or `run_tier=production-proof` when `live-e2e-run-health-report.overall_status=pass`; medium+ product acceptance additionally requires linked accepted step-quality request/report pairs and final all-pass outcome quality.
- `ky`, `commander-js`, and `pluggy` count as active required coverage only for their `small` flow-regression canary cells. Their medium+ product-change cells remain runnable extended candidates and do not close required product acceptance.

## Removed W14-S07 matrix fixture bundle (2026-04-24)

The old W14-S07 matrix fixture bundle was removed after the skill-agent-only migration. It remains historical planning context only; current matrix acceptance requires supported live profiles with accepted skill-agent decisions.
