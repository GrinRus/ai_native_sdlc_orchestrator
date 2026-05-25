# Live E2E target catalog

This catalog defines the curated repositories and curated feature missions AOR uses for live end-to-end rehearsal and acceptance.

Human-readable guidance lives here. Machine-readable enforcement lives under `scripts/live-e2e/catalog/targets/*.yaml`.

For canonical setup and verification dependency details per profile, use `docs/ops/live-e2e-dependency-matrix.md`.

## Safety policy
- Default to `no-write` bootstrap and bounded `patch-only` output.
- Never push to upstream public repositories by default.
- Mandatory full-journey live E2E is allowed only on curated catalog targets and curated feature missions.
- Full-journey runs must generate the feature request and discovery/spec/handoff during the run.
- Acceptance and production-proof full-journey runs must use isolated AOR source install by default and support the public `execution#N -> review#N` repair loop.
- Always materialize review, QA, and delivery artifacts for full-journey observation runs; release and learning become observed steps when the profile declares `live_e2e.flow_range_policy=full_lifecycle`.
- Every mandatory full-journey run must resolve one curated matrix cell:
  - `repo`
  - `feature mission`
  - `scenario family`
  - `provider variant`
  - `feature size`
  - `run tier`

## Target 1 — `sindresorhus/ky`
- Catalog id: `ky`
- Shape: small TypeScript library.
- Why it is useful: single-package repo, modern Node runtime, small blast radius, and crisp regression scope.
- Curated missions:
  - `ky-header-regression`
    - `small`, `regress`
    - bounded regression mission inside `source/**` and `test/**`
    - expected evidence: `verify-summary`, routed `step-result`, `review-report`
    - post-run primary gate: `npx xo`, `npm run build`, `npx ava test/headers.ts`; full `npm test` remains diagnostic evidence
  - `ky-fetch-options-regression`
    - `medium`, `regress|repair`
    - bounded multi-file regression across `source/**`, `test/**`, and `index.d.ts`
  - `ky-release-doc-typing`
    - `medium`, `release|governance`
    - release-shaped mission inside `source/**`, `test/**`, and `index.d.ts`
    - expected evidence: `delivery-manifest`, `release-packet`, `review-report`
  - `ky-retry-hooks-governance`
    - `large`, `governance|repair`
    - broader request lifecycle mission with stricter audit/learning closure
- Best profiles:
  - bounded: `regress-short.yaml`, `release-short.yaml`, `w7-governance-integration.yaml`
  - full-journey required cells:
    - `full-journey-regress-ky.yaml` (`regress/small/openai-primary`)
    - `full-journey-regress-ky-medium-anthropic.yaml` (`regress/medium/anthropic-primary`)
    - `full-journey-regress-ky-medium-open-code.yaml` (`regress/medium/open-code-primary`)
    - `full-journey-release-ky-medium-openai.yaml` (`release/medium/openai-primary`)
  - production-proof candidate:
    - `full-journey-production-proof-ky-openai.yaml` (`regress/small/openai-primary`, real external process, blocking target verification)
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Target 2 — `httpie/cli`
- Catalog id: `httpie-cli`
- Shape: medium Python CLI project.
- Why it is useful: different language/runtime, CLI-oriented workflow, and stronger local setup demands.
- Curated missions:
  - `httpie-cli-output-regression`
    - `small`, `regress`
    - bounded CLI regression mission inside `httpie/**` and `tests/**`
    - expected evidence: `verify-summary`, routed `step-result`, `review-report`
  - `httpie-cli-repair-exit-codes`
    - `medium`, `repair|governance`
    - bounded CLI behavior repair inside `httpie/**` and `tests/**`
  - `httpie-cli-config-surface-hardening`
    - `large`, `governance`
    - broader config/audit safe mission with explicit governance evidence
- Best profiles:
  - bounded: `regress-long.yaml`
  - full-journey required cells:
    - `full-journey-regress-httpie.yaml` (`regress/small/openai-primary`)
    - `full-journey-repair-httpie-medium-anthropic.yaml` (`repair/medium/anthropic-primary`)
    - `full-journey-governance-httpie-medium-openai.yaml` (`governance/medium/openai-primary`)
- Bootstrap baseline:
  - use `make install` before `make test` / `make codestyle`
- Full-journey verification baseline:
  - use the bounded CLI pytest slice plus `make codestyle`, not the entire repo-wide `make test` matrix
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Target 3 — `belgattitude/nextjs-monorepo-example`
- Catalog id: `nextjs-monorepo-example`
- Shape: public Next.js/Turborepo/Yarn monorepo with apps and packages.
- Why it is useful: representative monorepo topology, shared packages, app/package boundaries, and workspace-wide checks.
- Curated missions:
  - `nextjs-shared-util-regression`
    - `small`, `regress`
    - bounded shared util mission inside `packages/**`
  - `nextjs-workspace-repair-shared-config`
    - `medium`, `repair`
    - bounded workspace repair across shared package/config surfaces
  - `nextjs-shared-package-release`
    - `large`, `release|governance`
    - release-shaped mission inside `apps/**` and `packages/**`
    - expected evidence: `delivery-manifest`, `release-packet`, `review-report`
- Best profiles:
  - bounded: `release-long.yaml`
  - full-journey required cells:
    - `full-journey-release-nextjs.yaml` (`release/large/openai-primary`)
    - `full-journey-repair-nextjs-medium-anthropic.yaml` (`repair/medium/anthropic-primary`)
    - `full-journey-governance-nextjs-large-openai.yaml` (`governance/large/openai-primary`)
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `fork-first-pr`
- Full-journey verification baseline:
  - use monorepo-wide lint and typecheck plus shared-package unit smoke, not the entire repo-wide `g:test-unit` matrix

## Target 4 — `tj/commander.js`
- Catalog id: `commander-js`
- Shape: Node CLI framework.
- Why it is useful: mature command-line parsing surface, tight tests, and clear help/typing regressions.
- Curated missions:
  - `commander-option-suggestion-regression` (`small`, `regress`)
  - `commander-help-typing-repair` (`medium`, `repair|regress`)
  - `commander-cli-governance-lineage` (`medium`, `governance`)
- Best profiles:
  - `full-journey-regress-commander-js.yaml`
  - `full-journey-repair-commander-js-medium-anthropic.yaml`
  - `full-journey-governance-commander-js-medium-openai.yaml`
- Verification baseline: `npm ci`, `npm run test`, `npm run check`.

## Target 5 — `pytest-dev/pluggy`
- Catalog id: `pluggy`
- Shape: Python plugin/hook framework.
- Why it is useful: compact Python runtime with order-sensitive hook semantics and diagnostic surfaces.
- Curated missions:
  - `pluggy-hook-order-regression` (`small`, `regress`)
  - `pluggy-diagnostics-repair` (`medium`, `repair|regress`)
  - `pluggy-typing-governance` (`medium`, `governance|repair`)
- Best profiles:
  - `full-journey-regress-pluggy.yaml`
  - `full-journey-repair-pluggy-medium-anthropic.yaml`
  - `full-journey-governance-pluggy-medium-openai.yaml`
  - `full-journey-governance-pluggy-medium-open-code.yaml` (extended)
- Verification baseline: `python3 -m venv .aor/live-e2e-venv`,
  `.aor/live-e2e-venv/bin/python -m pip install -e . "pytest>=8" pytest-benchmark coverage`,
  `.aor/live-e2e-venv/bin/python -m pytest testing`.
- Checkout mode: full clone with tags. `pluggy` derives its package version from
  `setuptools-scm`; shallow checkouts produce an invalid local version and break
  pytest dependency resolution.

## Extended candidate targets
- `spf13/cobra` (`cobra`): Go CLI framework, extended small regress cell, `go mod download`, `go test ./...`.
- `date-fns/date-fns` (`date-fns`): TypeScript utility library, extended small regress cell, `pnpm install`, `pnpm vitest run`, `pnpm run lint`, `pnpm run types`.

## Why these targets
Together these targets cover:
- small library workflows;
- deeper CLI regressions;
- monorepo release-shaped delivery;
- more than one language/runtime;
- both bounded rehearsal and full-journey mission-driven acceptance;
- all mandatory scenario families: `regress`, `release`, `repair`, `governance`;
- provider comparison pairs between `openai-primary` and `anthropic-primary`.

## Full-journey acceptance rule
Mandatory full-journey live E2E is valid only when:
1. the profile resolves `target_catalog_id` through the curated machine-readable catalog;
2. the profile resolves `feature_mission_id` through that same catalog entry;
3. the profile pins `scenario_family` and `provider_variant_id`;
4. the runner prepares the feature request during the run;
5. discovery/spec/handoff trace back to that mission;
6. baseline target verification is recorded separately from execution readiness;
7. provider execution attempts a real code-changing run;
8. post-run target verification, Runtime Harness, review, QA, and delivery artifacts are present;
9. the resulting observation report preserves the same matrix cell and records post-delivery code/artifact findings without turning quality failures into hard runner failures.

## W14 matrix expectations
Required coverage matrix:
- `ky`
  - `regress/small/openai-primary`
  - `regress/medium/anthropic-primary`
  - `release/medium/openai-primary`
- `httpie/cli`
  - `regress/small/openai-primary`
  - `repair/medium/anthropic-primary`
  - `governance/medium/openai-primary`
- `nextjs-monorepo-example`
  - `release/large/openai-primary`
  - `repair/medium/anthropic-primary`
  - `governance/large/openai-primary`
- `commander-js`
  - `regress/small/openai-primary`
  - `repair/medium/anthropic-primary`
  - `governance/medium/openai-primary`
- `pluggy`
  - `regress/small/openai-primary`
  - `repair/medium/anthropic-primary`
  - `governance/medium/openai-primary`
  - `governance/medium/open-code-primary` (extended)

Extended candidate cells:
- `ky.governance.large.openai` (`ky-retry-hooks-governance`)
- `httpie-cli.governance.large.openai` (`httpie-cli-config-surface-hardening`)
- `pluggy.governance.medium.open-code` (`pluggy-typing-governance`)
- `nextjs.regress.small.openai` (`nextjs-shared-util-regression`)
- `cobra.regress.small.openai`
- `date-fns.regress.small.openai`

Provider comparison rule:
- every curated repo must prove at least one equivalent mission class on both `openai-primary` and `anthropic-primary`.
- `openai-primary` and `anthropic-primary` are mandatory provider variants for W14 matrix coverage.
- `open-code-primary` remains extended candidate coverage after W22-S03, including the cataloged `ky.regress.small.open-code`, `ky.regress.medium.open-code`, and `pluggy.governance.medium.open-code` cells. A 2026-05-25 local runtime permission smoke confirmed OpenCode full-bypass and restricted interaction evidence, but required OpenCode baseline certification still awaits a committed full-journey real-runner proof.

Feature-size taxonomy:
- `small`: one focused behavior surface, usually 1-2 files and one targeted regression.
- `medium`: bounded source plus test/type integration, usually 3-6 files.
- `large`: cross-package or release/governance lineage with broader artifact expectations.
- `xl`: manual or overnight rehearsal only; do not add xl cells to required coverage.

Run-tier taxonomy:
- `readme-smoke`: README-led no-write installed-user path.
- `bounded-live`: fast fail-closed provider proof.
- `full-journey-observation`: delivery-reaching evidence with findings allowed.
- `acceptance`: required matrix closure when canonical status is fully passing.
- `production-proof`: strict real-runner proof with no mock and no upstream writes.

Required matrix closure rule:
- `coverage_status=covered_pass` closes required coverage only for `run_tier=acceptance` or `run_tier=production-proof`.
- `coverage_status=covered_with_findings` is useful evidence but must not be reported as completed acceptance.
- `coverage_status=attempted_failed` means the matrix cell was attempted and did not close.

Canonical matrix-cell examples:
- `small/regress/openai-primary`: `full-journey-regress-ky.yaml`
- `medium/repair/anthropic-primary`: `full-journey-repair-httpie-medium-anthropic.yaml`
- `large/release/openai-primary`: `full-journey-release-nextjs.yaml`

Production-proof candidate:
- `full-journey-production-proof-ky-openai.yaml` uses the same curated `ky.regress.small.openai` cell, but enables `production_proof` fail-closed checks. It is the operator profile for W25-S01/W25-S02 real-run proof preparation and must not be counted as completed production proof until a real non-mock W25-S02 run records `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, required target verdicts `pass`, and a passing no-upstream-write assertion.
- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json` is the committed sanitized proof fixture for the first completed production proof. It covers only the `ky.regress.small.openai` production cell and must not be generalized to Claude, OpenCode, or broader production-readiness claims without additional executable evidence.

## Shared no-write preflight baseline
All targets reuse the same baseline before execution-style stages:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. continue only when no-write safety gates pass

For full-journey profiles, `verification.baseline_gate.mode` defaults to `diagnostic`: target verification command failures are baseline context when setup, validation, routed dry-run, adapter readiness, and safety gates pass. For bounded profiles, the default is `blocking`. Post-run verification remains mandatory quality evidence for full-journey observation and contributes directly to the step journal and final analysis.

See `docs/ops/live-e2e-no-write-preflight.md` for the reusable bounded procedure.
