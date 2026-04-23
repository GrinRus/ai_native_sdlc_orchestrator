# Live E2E target catalog

This catalog defines the public repositories AOR uses for live end-to-end rehearsals.

For canonical setup and verification dependency details per profile, use `docs/ops/live-e2e-dependency-matrix.md`.

## Safety policy
- Default to **read-only bootstrap and patch output**.
- Never push to upstream public repositories by default.
- If a delivery rehearsal needs write-back, use a personal fork or a local mirror.
- Always produce a delivery manifest when the rehearsal reaches delivery.

## Target 1 — `sindresorhus/ky`
- Shape: small TypeScript library.
- Why it is useful: single-package repo, modern Node runtime, small blast radius, and a crisp `test` command.
- Current signals from the repository:
  - Node `>=22`
  - `npm test` runs `xo`, `build`, and `ava`
  - the project is a tiny HTTP client with no runtime dependencies
- Best scenarios:
  - `regress short`
  - `release short`
  - `w7 governance integration`
- Suggested rehearsal task:
  - add or adjust one narrow regression test;
  - make the smallest source change needed;
  - stop at patch, local branch, or fork PR draft.
- Prerequisites:
  - Node `>=22` and npm available;
  - network access for clone and install.
- Failure-safe defaults:
  - keep `write_back_to_remote=false`;
  - keep delivery mode in `patch-only`.
- Abort conditions:
  - checkout or install fails;
  - `npm test` fails during preflight.

## Target 2 — `httpie/cli`
- Shape: medium Python CLI project.
- Why it is useful: different language, CLI-oriented workflow, stronger local setup, and richer test targets.
- Current signals from the repository:
  - main development instructions use `make all`
  - local checks include `make test`, `make test-cover`, and `make codestyle`
  - the project uses `pytest`
- Best scenario:
  - `regress long`
- Suggested rehearsal task:
  - implement a bounded bug fix or UX improvement in one CLI surface;
  - add or update tests;
  - verify with `make test` and `make codestyle`.
- Prerequisites:
  - Python, pip, and `make` available;
  - network access for clone and dependency setup.
- Failure-safe defaults:
  - keep `write_back_to_remote=false`;
  - stop at patch output or fork-local branch only.
- Abort conditions:
  - checkout or setup path fails;
  - `make test` or `make codestyle` fails during preflight.

## Target 3 — `belgattitude/nextjs-monorepo-example`
- Shape: public Next.js/Turborepo/Yarn monorepo with apps and packages.
- Why it is useful: representative monorepo topology, shared packages, app/package boundaries, and workspace-wide checks.
- Current signals from the repository:
  - install starts with `corepack enable` and `yarn install`
  - root scripts include `g:lint`, `g:typecheck`, and `g:test-unit`
  - the workspace uses `apps/*` and `packages/*`
- Best scenario:
  - `release long`
- Suggested rehearsal task:
  - update one shared package and one consuming app;
  - run workspace lint, typecheck, and unit tests;
  - materialize release packet and delivery manifest for a fork or local mirror.
- Prerequisites:
  - Node + corepack + yarn available;
  - network access for clone and workspace install;
  - shell resources suitable for monorepo checks.
- Failure-safe defaults:
  - keep `write_back_to_remote=false`;
  - keep delivery mode in `fork-first-pr` unless policy explicitly changes.
- Abort conditions:
  - checkout or workspace install fails;
  - `yarn g:lint`, `yarn g:typecheck`, or `yarn g:test-unit` fails.

## Why these targets
Together these targets cover:
- small library workflows;
- deeper CLI regressions;
- monorepo release-shaped delivery;
- more than one language/runtime;
- both short and long rehearsal budgets.

## Shared no-write preflight baseline
All targets must reuse the same baseline sequence before execution-style stages:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. stop or continue only when no-write safety gates pass

See `docs/ops/live-e2e-no-write-preflight.md` for the reusable procedure used by bootstrap, quality, and delivery rehearsals.

## Latest observed evidence bundle
- `examples/live-e2e/fixtures/w12-s04/w12-s04-evidence-bundle.json` is the current canonical short-profile proof bundle.
- The bundle links target-backed checkout evidence, routed live adapter raw evidence, and target-root delivery/release lineage for `regress-short` and `release-short`.
- The proof keeps installed-user black-box CLI execution and uses a deterministic `--examples-root` override only for the adapter external runtime so the bundle stays reproducible.
