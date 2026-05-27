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
| `full-journey-production-proof-ky-openai` | `node >=22`, `npm`, `git`, Playwright runtime support, authenticated `codex` CLI with non-interactive edit permissions | `npm install`<br>`npx playwright install` | `npm test` | npm packages + Playwright browser binaries + external runner auth/config | `not authenticated`, permission/readiness denial, missing `codex`, or blocking target verification failure before `run start` |
| `commander-js` full-journey profiles | `node >=22`, `npm`, `git` | `npm ci` | `npm run test`<br>`npm run check` | npm packages | lockfile install errors, failing parser/help tests, or check script errors |
| `pluggy` full-journey profiles | `python3 >=3.9`, `pip`, `git` | `python3 -m venv .aor/live-e2e-venv`<br>`.aor/live-e2e-venv/bin/python -m pip install -e . "pytest>=8" pytest-benchmark coverage` | `.aor/live-e2e-venv/bin/python -m pytest testing` | Python dependencies from index/mirror | venv creation, editable install, or pytest failure |
| `cobra` extended target | `go`, `git` | `go mod download` | `go test ./...` | Go module downloads | module download or Go test failure |
| `date-fns` extended target | `node >=22`, `pnpm`, `git` | `pnpm install` | `pnpm vitest run`<br>`pnpm run lint`<br>`pnpm run types` | pnpm packages | Vitest, lint, or typecheck failure |
| `installed-user-guided-journey` | `node >=22`, `npm`, `git`, authenticated `codex` CLI, local web runtime support | target catalog commands for `ky` plus operator console static render | target catalog commands plus guided web task proof | npm packages + Playwright browser binaries when the target commands require them | missing auth/permission readiness, failed target verification, missing web HTML/DOM/accessibility/screenshot evidence, or missing skill-agent UI verdict |

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
- If an external CDN/network dependency is unavailable (for example Playwright browser download), mark the run as external `inconclusive` for smoke tracking.

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
- promoted run summaries must record `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, passing required target verdicts, Runtime Harness/review/delivery evidence refs, and `no_upstream_write_assertion.status=pass`.
- the committed W25-S03 fixture lives at `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`; it is sanitized proof evidence for the `ky.regress.small.openai` production cell only, and proof integrity rejects mock-backed `full_code_changing_runtime` claims.

## Removed bounded fixture bundles

The legacy W7/W10/W11/W12 bounded rehearsal bundles were removed from the repository when live E2E moved to skill-agent-only proof. Those artifacts predate the current acceptance model, did not require accepted `operator_decision_ref` evidence for every included step, and must not be cited as live acceptance closure. Historical backlog rows may still describe why those waves existed, but current live proof evidence starts at catalog-backed full journeys, `installed-user-guided-journey`, and the W25 production-proof fixture.

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

## Removed W14-S07 matrix fixture bundle (2026-04-24)

The old W14-S07 matrix fixture bundle was removed after the skill-agent-only migration. It remains historical planning context only; current matrix acceptance requires supported live profiles with accepted skill-agent decisions.
