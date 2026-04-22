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
5. Run routed dry-run smoke (`project verify --routed-dry-run-step implement`) before any delivery-stage action.

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
- See `docs/ops/live-e2e-dependency-matrix.md` for canonical dependency and command requirements.
- Local environment must allow npm dependency and Playwright browser downloads.

## Abort conditions
- Clone or dependency installation fails.
- `npm test` fails during preflight verification.
- Any requested delivery mode requires upstream write-back.

## Start command
```bash
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/regress-short.yaml
```

## Optional UI attach
```bash
aor ui attach --run RUN-201 --control-plane http://localhost:8080
```

## Expected verification
- setup command `npm install` succeeds;
- setup command `npx playwright install` succeeds;
- `npm test` succeeds;
- handoff packet and step results are materialized;
- routed dry-run step result is materialized with route/asset/policy/adapter metadata;
- evidence and live events are available;
- no upstream write-back occurs.
