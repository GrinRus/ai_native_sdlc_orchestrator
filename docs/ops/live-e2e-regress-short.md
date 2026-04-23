# Runbook: live E2E — regress short

## Target
- Repository: `https://github.com/sindresorhus/ky.git`
- Branch/ref: `main`
- Goal: fast regression smoke on a small TypeScript library
- Repo shape note: single-package TypeScript library with npm-first verification

## When to use it
- after route, wrapper, adapter, or prompt-bundle changes;
- after CLI/API flow changes that need a real repository smoke test;
- before moving to longer rehearsals.

## Objective
Confirm that AOR can:
- bootstrap a real public repository;
- materialize the packet chain;
- execute a narrow bounded change;
- collect evidence and finish without depending on the web UI.

## Default task brief
1. Analyze the repository and verify setup.
2. Confirm install and verification commands.
3. Apply one narrow regression-test-backed change.
4. Produce patch output or a local/fork branch.
5. Run the internal harness through preflight verify plus routed live execution before any delivery-stage action.

## No-write preflight
Use `docs/ops/live-e2e-no-write-preflight.md` and keep the sequence explicit:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. stop unless no-write gates pass

Isolation mode defaults:
- use `workspace-clone` when this rehearsal feeds patch-only or fork-first delivery preparation;
- keep `ephemeral` only for bootstrap smoke with no delivery mutation intent.

## Prerequisites
- Node `>=22` and npm available.
- Network access for clone and dependency install.
- Local shell can run `npm test`.

## Abort conditions
- Clone or dependency installation fails.
- `npm test` fails during preflight verification.
- Any requested delivery mode requires upstream write-back.

## Harness command
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/regress-short.yaml
```

## Expected verification
- setup command `npm install` succeeds;
- setup command `npx playwright install` succeeds;
- `npm test` succeeds;
- handoff packet and step results are materialized;
- routed live step result is materialized with route/asset/policy/adapter metadata;
- evidence and live events are available;
- no upstream write-back occurs.

## W12-S04 refreshed black-box proof (2026-04-23)
Observed run:
- `w12-s04.regress-short` with status `pass`.

Evidence note:
- this run is target-backed (`target_checkout_root`), keeps routed live adapter evidence, and links compiled context plus learning-loop artifacts in one bundle.
- proof was generated through `node ./scripts/live-e2e/run-profile.mjs` and keeps the CLI subprocess flow black-box while using a deterministic external runner mock via `--examples-root`.

Canonical fixtures:
- `examples/live-e2e/fixtures/w12-s04/regress-short.run-summary.json`
- `examples/live-e2e/fixtures/w12-s04/regress-short.scorecard.json`
- `examples/live-e2e/fixtures/w12-s04/regress-short.routed-step-result.json`
- `examples/live-e2e/fixtures/w12-s04/regress-short.compiled-context.json`
- `examples/live-e2e/fixtures/w12-s04/regress-short.learning-loop-scorecard.json`
- `examples/live-e2e/fixtures/w12-s04/regress-short.learning-loop-handoff.json`
