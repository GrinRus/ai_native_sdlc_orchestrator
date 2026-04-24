# Live E2E target catalog

This catalog defines the curated repositories and curated feature missions AOR uses for live end-to-end rehearsal and acceptance.

Human-readable guidance lives here. Machine-readable enforcement lives under `scripts/live-e2e/catalog/targets/*.yaml`.

For canonical setup and verification dependency details per profile, use `docs/ops/live-e2e-dependency-matrix.md`.

## Safety policy
- Default to read-only bootstrap and bounded patch output.
- Never push to upstream public repositories by default.
- Mandatory full-journey live E2E is allowed only on curated catalog targets and curated feature missions.
- Full-journey runs must generate the feature request and discovery/spec/handoff during the run.
- Always materialize review and learning closure artifacts for full-journey runs.
- Every mandatory full-journey run must resolve one curated matrix cell:
  - `repo`
  - `feature mission`
  - `scenario family`
  - `provider variant`
  - `feature size`

## Target 1 — `sindresorhus/ky`
- Catalog id: `ky`
- Shape: small TypeScript library.
- Why it is useful: single-package repo, modern Node runtime, small blast radius, and crisp regression scope.
- Curated missions:
  - `ky-header-regression`
    - `small`, `regress`
    - bounded regression mission inside `source/**` and `test/**`
    - expected evidence: `verify-summary`, routed `step-result`, `review-report`
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
    - `full-journey-release-ky-medium-openai.yaml` (`release/medium/openai-primary`)
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch`

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
  - preferred delivery mode: `patch`

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
6. public `review run`, `audit runs`, and `learning handoff` artifacts are present;
7. the resulting artifacts preserve the same matrix cell.

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

Provider comparison rule:
- every curated repo must prove at least one equivalent mission class on both `openai-primary` and `anthropic-primary`.
- `openai-primary` and `anthropic-primary` are mandatory provider variants for W14 matrix coverage.
- `open-code-primary` remains extended coverage and is not a day-one required acceptance gate.

Canonical matrix-cell examples:
- `small/regress/openai-primary`: `full-journey-regress-ky.yaml`
- `medium/repair/anthropic-primary`: `full-journey-repair-httpie-medium-anthropic.yaml`
- `large/release/openai-primary`: `full-journey-release-nextjs.yaml`

## Shared no-write preflight baseline
All targets reuse the same baseline before execution-style stages:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. continue only when no-write safety gates pass

See `docs/ops/live-e2e-no-write-preflight.md` for the reusable bounded procedure.
