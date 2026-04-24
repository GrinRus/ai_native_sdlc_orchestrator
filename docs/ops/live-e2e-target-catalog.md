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

## Target 1 — `sindresorhus/ky`
- Catalog id: `ky`
- Shape: small TypeScript library.
- Why it is useful: single-package repo, modern Node runtime, small blast radius, and crisp regression scope.
- Curated missions:
  - `ky-header-regression`
    - bounded regression mission inside `source/**` and `test/**`
    - expected evidence: `verify-summary`, routed `step-result`, `review-report`
  - `ky-release-doc-typing`
    - release-shaped mission inside `source/**`, `test/**`, and `index.d.ts`
    - expected evidence: `delivery-manifest`, `release-packet`, `review-report`
- Best profiles:
  - bounded: `regress-short.yaml`, `release-short.yaml`, `w7-governance-integration.yaml`
  - full-journey: `full-journey-regress-ky.yaml`
- Failure-safe defaults:
  - `write_back_to_remote=false`
  - preferred delivery mode: `patch`

## Target 2 — `httpie/cli`
- Catalog id: `httpie-cli`
- Shape: medium Python CLI project.
- Why it is useful: different language/runtime, CLI-oriented workflow, and stronger local setup demands.
- Curated missions:
  - `httpie-cli-output-regression`
    - bounded CLI regression mission inside `httpie/**` and `tests/**`
    - expected evidence: `verify-summary`, routed `step-result`, `review-report`
- Best profiles:
  - bounded: `regress-long.yaml`
  - full-journey: `full-journey-regress-httpie.yaml`
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
  - `nextjs-shared-package-release`
    - release-shaped mission inside `apps/**` and `packages/**`
    - expected evidence: `delivery-manifest`, `release-packet`, `review-report`
- Best profiles:
  - bounded: `release-long.yaml`
  - full-journey: `full-journey-release-nextjs.yaml`
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
- both bounded rehearsal and full-journey mission-driven acceptance.

## Full-journey acceptance rule
Mandatory full-journey live E2E is valid only when:
1. the profile resolves `target_catalog_id` through the curated machine-readable catalog;
2. the profile resolves `feature_mission_id` through that same catalog entry;
3. the runner prepares the feature request during the run;
4. discovery/spec/handoff trace back to that mission;
5. public `review run`, `audit runs`, and `learning handoff` artifacts are present.

## W13-S06 full-journey proof bundle (2026-04-24)
Committed evidence proving the curated full-journey layer:
- `examples/live-e2e/fixtures/w13-s06/w13-s06-evidence-bundle.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-regress-ky.review-report.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-regress-httpie.review-report.json`
- `examples/live-e2e/fixtures/w13-s06/full-journey-release-nextjs.release-packet.json`

Bundle guarantees:
- repo and mission both resolve through the curated machine-readable catalog;
- feature request, intake packet, discovery analysis, spec step-result, and handoff packet are all generated during the run;
- review verdict is backed by public `review-report`;
- closure is backed by public `audit runs` and `learning handoff`.

## Shared no-write preflight baseline
All targets reuse the same baseline before execution-style stages:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. continue only when no-write safety gates pass

See `docs/ops/live-e2e-no-write-preflight.md` for the reusable bounded procedure.
