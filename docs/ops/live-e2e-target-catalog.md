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
    - post-run primary gate uses `test/main.ts`, `test/hooks.ts`, and focused
      `test/retry.ts --match='*shouldRetry*'`; the full timing-heavy retry
      suite remains diagnostic evidence with an 1800 second target command
      budget on governance large profiles
  - `ky-request-lifecycle-observability-xlarge`
    - `xlarge`, `governance|repair`, manual-only
    - broader retry, hook, public type, and observability rehearsal with operator
      review required for every controller step
- Best profiles:
  - full-journey required cells:
    - `full-journey-regress-ky.yaml` (`regress/small/openai-primary`)
    - `full-journey-regress-ky-small-codex.yaml` (`regress/small/openai-primary`, codex-cli)
    - `full-journey-regress-ky-medium-codex.yaml` (`regress/medium/openai-primary`, codex-cli)
    - `full-journey-regress-ky-medium-anthropic.yaml` (`regress/medium/anthropic-primary`)
    - `full-journey-regress-ky-medium-open-code.yaml` (`regress/medium/open-code-primary`)
    - `full-journey-regress-ky-small-qwen.yaml` (`regress/small/qwen-primary`, extended)
    - `full-journey-regress-ky-medium-qwen.yaml` (`regress/medium/qwen-primary`, extended)
    - `full-journey-release-ky-medium-openai.yaml` (`release/medium/openai-primary`)
    - `full-journey-governance-ky-large-codex.yaml` (`governance/large/openai-primary`, codex-cli)
    - `full-journey-governance-ky-large-anthropic.yaml` (`governance/large/anthropic-primary`)
  - installed-user browser-task candidate:
    - `installed-user-guided-journey.yaml` (`regress/small/openai-primary`)
    - `installed-user-guided-journey-anthropic.yaml` (`regress/small/anthropic-primary`)
    - `installed-user-guided-journey-qwen.yaml` (`regress/small/qwen-primary`, extended)
  - manual-only xlarge profiles:
    - `manual-xlarge-governance-ky-openai.yaml` (`governance/xlarge/openai-primary`)
    - `manual-xlarge-governance-ky-anthropic.yaml` (`governance/xlarge/anthropic-primary`)
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
  - `httpie-cli-request-policy-orchestration-xlarge`
    - `xlarge`, `governance|release`, manual-only
    - cross-surface request policy rehearsal across config, request
      construction, diagnostics, tests, and governance artifacts
- Best profiles:
  - full-journey required cells:
    - `full-journey-regress-httpie.yaml` (`regress/small/openai-primary`)
    - `full-journey-repair-httpie-medium-anthropic.yaml` (`repair/medium/anthropic-primary`)
    - `full-journey-governance-httpie-medium-openai.yaml` (`governance/medium/openai-primary`)
  - manual-only xlarge profiles:
    - `manual-xlarge-governance-httpie-openai.yaml` (`governance/xlarge/openai-primary`)
    - `manual-xlarge-governance-httpie-anthropic.yaml` (`governance/xlarge/anthropic-primary`)
- Bootstrap baseline:
  - use `make install` before `make test` / `make codestyle`
- Full-journey verification baseline:
  - use the bounded CLI pytest slice plus `make codestyle`, not the entire repo-wide `make test` matrix
  - large and xlarge all-pass closure requires primary and diagnostic pytest
    output to be warning-clean; exit-0 `ResourceWarning` stderr is a target
    outcome-quality gap, not acceptable all-pass evidence
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
  - `nextjs-cross-package-release-orchestration`
    - `xlarge`, `release|governance`, manual-only
    - cross-package release rehearsal with multiple package/app boundaries,
      tests, release notes or changesets, delivery, release, and learning evidence
- Best profiles:
  - full-journey required cells:
    - `full-journey-release-nextjs.yaml` (`release/large/openai-primary`)
    - `full-journey-repair-nextjs-medium-anthropic.yaml` (`repair/medium/anthropic-primary`)
    - `full-journey-governance-nextjs-large-openai.yaml` (`governance/large/openai-primary`)
  - manual-only xlarge profiles:
    - `manual-xlarge-release-nextjs-openai.yaml` (`release/xlarge/openai-primary`)
    - `manual-xlarge-release-nextjs-anthropic.yaml` (`release/xlarge/anthropic-primary`)
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

## Candidate Target 6 — `colinhacks/zod`
- Catalog id: `zod`
- Shape: TypeScript schema validation package with runtime parsing, type inference,
  and JSON Schema conversion.
- Why it is useful: exercises runtime semantics plus public type-surface coherence
  in a compact package.
- Curated missions:
  - `zod-json-schema-regression`
    - `medium`, `regress|repair`, `extended`
    - bounded JSON Schema conversion mission across runtime behavior, tests, and
      type surface
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `pnpm run build`, `pnpm test`, `pnpm run lint:check`
- Best profile:
  - `full-journey-regress-zod-medium-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Candidate Target 7 — `encode/httpx`
- Catalog id: `httpx`
- Shape: Python HTTP client with sync/async APIs, strict timeouts, transports, and
  typing.
- Why it is useful: adds network/runtime semantics without requiring real external
  services for the regression path.
- Curated missions:
  - `httpx-timeout-transport-regression`
    - `medium`, `regress|repair`, `extended`
    - bounded timeout or transport behavior mission with focused pytest, Ruff, and
      mypy evidence
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `./scripts/sync-version`,
      `.aor/live-e2e-venv/bin/python -m pytest tests/test_timeouts.py`,
      `.aor/live-e2e-venv/bin/ruff check httpx tests`, and
      `.aor/live-e2e-venv/bin/mypy httpx tests`
- Best profile:
  - `full-journey-regress-httpx-medium-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Candidate Target 8 — `eslint/eslint`
- Catalog id: `eslint`
- Shape: JavaScript lint rule engine with AST analysis, autofix behavior, CLI tests,
  and rule metadata.
- Why it is useful: exercises code-analysis semantics, fixture-driven regression,
  and generated metadata consistency.
- Curated missions:
  - `eslint-rule-autofix-regression`
    - `medium`, `regress|repair`, `extended`
    - bounded rule or autofix mission with RuleTester coverage and rule/type
      metadata checks
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `npm run test:cli`, `npm run lint:rule-types`,
      and `npm run lint:types`
- Best profile:
  - `full-journey-regress-eslint-medium-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Candidate Target 9 — `fastify/fastify`
- Catalog id: `fastify`
- Shape: Node.js web framework with routing, validation, hooks, plugins, and type
  tests.
- Why it is useful: adds framework lifecycle and schema/plugin repair behavior
  beyond CLI and library targets.
- Curated missions:
  - `fastify-schema-plugin-repair`
    - `medium`, `repair|regress`, `extended`
    - bounded schema validation, plugin registration, or lifecycle hook repair
      with tests and type evidence
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `npm run test:ci`, `npm run lint`
- Best profile:
  - `full-journey-repair-fastify-medium-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Candidate Target 10 — `prettier/prettier`
- Catalog id: `prettier`
- Shape: JavaScript/TypeScript formatter with parser/printer behavior and snapshot
  fixtures.
- Why it is useful: deterministic formatter output makes reviewable regression
  evidence, while snapshot churn keeps the target meaningfully strict.
- Curated missions:
  - `prettier-typescript-format-regression`
    - `medium`, `regress|repair`, `extended`
    - bounded TypeScript or Markdown formatting mission with focused snapshot
      evidence
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `yarn lint:typecheck`, `yarn lint:eslint`, and
      `yarn test tests/format/typescript tests/format/markdown`
- Best profile:
  - `full-journey-regress-prettier-medium-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`

## Candidate Target 11 — `astral-sh/ruff`
- Catalog id: `ruff`
- Shape: Rust monorepo for Python linting and formatting.
- Why it is useful: exercises Rust implementation, Python lint rule semantics,
  autofix fixtures, and formatter-adjacent regression evidence.
- Curated missions:
  - `ruff-rule-autofix-regression`
    - `large`, `regress|repair`, `extended`
    - bounded lint rule or autofix mission with Rust test and fixture evidence
    - expected evidence: `verify-summary`, `routed-step-result`, `review-report`,
      `delivery-manifest`
    - post-run primary gate: `cargo test -p ruff_linter`,
      `cargo test -p ruff_python_formatter`
- Best profile:
  - `full-journey-regress-ruff-large-openai.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch-only`
- Operational note: keep this as extended/manual or overnight coverage until the
  Rust build and snapshot costs are proven stable in live runs.

## Extended candidate targets
- `spf13/cobra` (`cobra`): Go CLI framework, extended small regress cell, `go mod download`, `go test ./...`.
- `date-fns/date-fns` (`date-fns`): TypeScript utility library, extended small regress cell, `pnpm install`, `pnpm vitest run`, `pnpm run lint`, `pnpm run types`.
- `colinhacks/zod` (`zod`): TypeScript schema validator, extended medium JSON Schema regression cell, `pnpm install`, `pnpm run build`, `pnpm test`, `pnpm run lint:check`.
- `encode/httpx` (`httpx`): Python HTTP client, extended medium timeout/transport regression cell, `.aor` venv install, targeted pytest, Ruff, and mypy.
- `eslint/eslint` (`eslint`): JavaScript lint rule engine, extended medium autofix regression cell, `npm install`, rule tests, and rule/type metadata checks.
- `fastify/fastify` (`fastify`): Node.js web framework, extended medium schema/plugin repair cell, `npm install`, `npm run test:ci`, `npm run lint`.
- `prettier/prettier` (`prettier`): formatter snapshot target, extended medium TypeScript formatting regression cell, `yarn install --immutable`, typecheck, ESLint, and focused format tests.
- `astral-sh/ruff` (`ruff`): Rust Python linter/formatter, extended large rule/autofix regression cell, `cargo fetch`, targeted crate tests.

## Why these targets
Together these targets cover:
- small library workflows;
- deeper CLI regressions;
- monorepo release-shaped delivery;
- more than one language/runtime;
- schema/type-surface regressions;
- sync/async network semantics;
- AST rule/autofix behavior;
- web framework lifecycle repair;
- formatter snapshot governance;
- Rust rule and formatter-adjacent test surfaces;
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

## Run selection and product rotation
For live E2E success-rate analysis, choose different products and different
feature missions across successive runs. A repeated `target_catalog_id` plus
`feature_mission_id` pair is useful for reproducing a failure, confirming a
repair, comparing providers, or proving production-readiness for the same matrix
cell, but it should not be the default sampling strategy.

Preferred run selection order:
1. pick a target product that was not used in the most recent comparable run;
2. pick a feature mission that was not used in the most recent run for that
   target;
3. vary `scenario_family`, `feature_size`, and `provider_variant_id` when the
   objective is broad live E2E quality evidence;
4. record the reason when intentionally repeating the same target and mission.

This keeps catalog evidence representative across libraries, CLIs, frameworks,
formatters, monorepos, and Rust/Python/TypeScript stacks instead of optimizing
the runner around one known-good repository.

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
- `ky.regress.small.openai.codex` (`ky-header-regression`)
- `ky.regress.medium.openai.codex` (`ky-fetch-options-regression`)
- `ky.governance.large.openai` (`ky-retry-hooks-governance`)
- `ky.governance.large.anthropic` (`ky-retry-hooks-governance`)
- `ky.regress.small.qwen` (`ky-header-regression`)
- `ky.regress.medium.qwen` (`ky-fetch-options-regression`)
- `httpie-cli.governance.large.openai` (`httpie-cli-config-surface-hardening`)
- `ky.governance.xlarge.openai` / `ky.governance.xlarge.anthropic` (`ky-request-lifecycle-observability-xlarge`, manual-only)
- `httpie-cli.governance.xlarge.openai` / `httpie-cli.governance.xlarge.anthropic` (`httpie-cli-request-policy-orchestration-xlarge`, manual-only)
- `nextjs.release.xlarge.openai` / `nextjs.release.xlarge.anthropic` (`nextjs-cross-package-release-orchestration`, manual-only)
- `pluggy.governance.medium.open-code` (`pluggy-typing-governance`)
- `nextjs.regress.small.openai` (`nextjs-shared-util-regression`)
- `cobra.regress.small.openai`
- `date-fns.regress.small.openai`
- `zod.regress.medium.openai` (`zod-json-schema-regression`)
- `httpx.regress.medium.openai` (`httpx-timeout-transport-regression`)
- `eslint.regress.medium.openai` (`eslint-rule-autofix-regression`)
- `fastify.repair.medium.openai` (`fastify-schema-plugin-repair`)
- `prettier.regress.medium.openai` (`prettier-typescript-format-regression`)
- `ruff.regress.large.openai` (`ruff-rule-autofix-regression`)

Provider comparison rule:
- every curated repo must prove at least one equivalent mission class on both `openai-primary` and `anthropic-primary`.
- `openai-primary` and `anthropic-primary` are mandatory provider variants for W14 matrix coverage.
- `open-code-primary` remains extended candidate coverage after W22-S03, including the cataloged `ky.regress.small.open-code`, `ky.regress.medium.open-code`, and `pluggy.governance.medium.open-code` cells. A 2026-05-25 local runtime permission smoke confirmed OpenCode full-bypass and restricted interaction evidence, and a same-day `ky.regress.medium.open-code` full-journey attempt reached real `open-code` execution before blocking on provider timeout. Required OpenCode baseline certification still awaits a passing committed full-journey real-runner proof.
- `qwen-primary` is extended candidate coverage for local operator proof runs. It is limited to Qwen full-bypass/Yolo execution until restricted/default permission behavior and a passing committed full-journey proof promote the adapter. The Qwen adapter uses explicit headless auth selection plus an `env_from` host alias for setups that expose `ANTHROPIC_AUTH_TOKEN` but require `ANTHROPIC_API_KEY` at the Qwen CLI boundary. Candidate runs use Qwen `--bare`, `--output-format stream-json`, `--include-partial-messages`, and `--exclude-tools skill` so AOR can observe progress before final output while Runtime Harness still blocks any `.qwen/` runner-owned state that appears inside the target checkout. Qwen's extended coverage tier and stream output are adapter/maturity details; live E2E lifecycle, retry/repair policy, target classification, and operator evidence semantics must stay aligned with Codex, Claude, and OpenCode profiles.
- W40 optional provider qualification uses `docs/ops/live-e2e-provider-qualification.md` and `provider_qualification_matrix` reports to separate catalog `coverage_tier` from current-release `release_blocking` policy. A provider cell can be `qualified`, `candidate`, `blocked`, or `not-run` only from public owner/phase evidence; provider name alone must not determine the status.

Ky feature missions also declare `change_evidence.required_path_prefixes` so
`real_code_change_status` can distinguish mission-relevant source changes from
provider scratch output. Small header regressions require evidence under
`source/` or `test/`; medium, release, and governance missions may also satisfy
the evidence gate through the public type surface `index.d.ts`. These prefixes
are not delivery path allowlists or blocklists; they are the minimum surfaces
that can prove the provider changed the target in a way that could satisfy the
selected mission.

Feature-size taxonomy:
- `small`: one focused behavior surface, usually 1-2 files and one targeted regression.
- `medium`: bounded source plus test/type integration, usually 3-6 files.
- `large`: cross-package or release/governance lineage with broader artifact expectations.
- `xlarge`: manual or overnight rehearsal only; do not add xlarge cells to required coverage or qualification sets. Legacy `xl` inputs are accepted as `xlarge`, but new catalog entries must use `xlarge`.

Strict all-pass quality loops may include xlarge as manual observation evidence,
but xlarge still cannot close required provider qualification or acceptance
matrix coverage.

Run-tier taxonomy:
- `readme-smoke`: README-led no-write installed-user path.
- `bounded-live`: fast fail-closed provider proof.
- `full-journey-observation`: delivery-reaching evidence with findings allowed.
- `acceptance`: required matrix attempt that may qualify only when run-health passes and required evidence is materialized.
- `production-proof`: strict real-runner proof with no mock and no upstream writes.

Required matrix closure rule:
- required coverage can close only for `run_tier=acceptance` or `run_tier=production-proof` with `live-e2e-run-health-report.overall_status=pass`;
- run-health findings identify why a run attempt did not qualify;
- outcome quality findings belong in `live-e2e-quality-assessment-report` and are advisory for acceptance follow-up, not provider qualification status.
- local quality-driven rerun loops may additionally require
  `quality-assessment gate --policy all-pass`; that gate remains separate from
  run-health and qualification accounting.

Canonical matrix-cell examples:
- `small/regress/openai-primary`: `full-journey-regress-ky-small-codex.yaml`
- `medium/regress/openai-primary`: `full-journey-regress-ky-medium-codex.yaml`
- `small/regress/qwen-primary`: `full-journey-regress-ky-small-qwen.yaml`
- `medium/regress/qwen-primary`: `full-journey-regress-ky-medium-qwen.yaml`
- `medium/repair/anthropic-primary`: `full-journey-repair-httpie-medium-anthropic.yaml`
- `large/governance/openai-primary`: `full-journey-governance-ky-large-codex.yaml`
- `large/governance/anthropic-primary`: `full-journey-governance-ky-large-anthropic.yaml`
- `large/release/openai-primary`: `full-journey-release-nextjs.yaml`

Production-proof candidate:
- `full-journey-production-proof-ky-openai.yaml` uses the same curated `ky.regress.small.openai` cell, but enables `production_proof` fail-closed checks. It is the operator profile for W25-S01/W25-S02 real-run proof preparation and must not be counted as completed production proof until a real non-mock W25-S02 run records `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, materialized runtime/review/delivery evidence refs, and a passing no-upstream-write assertion.
- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json` is the committed sanitized proof fixture for the first completed production proof. It covers only the `ky.regress.small.openai` production cell and must not be generalized to Claude, OpenCode, or broader production-readiness claims without additional executable evidence.

## Shared no-write preflight baseline
All targets reuse the same baseline before execution-style stages:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. continue only when no-write safety gates pass

For full-journey profiles, `verification.baseline_gate.mode` defaults to `diagnostic`: target verification command failures are baseline context when setup, validation, routed dry-run, adapter readiness, and safety gates pass. Historical bounded summaries used a blocking baseline gate, but bounded deterministic profiles are not current live E2E acceptance inputs. Post-run verification remains mandatory factual evidence for full-journey observation and contributes directly to the step journal, run-health, and post-run quality assessment.

See `docs/ops/live-e2e-no-write-preflight.md` for the reusable bounded procedure.
