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

## No-write preflight
Use `docs/ops/live-e2e-no-write-preflight.md` and keep the sequence explicit:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. stop unless no-write gates pass

## Prerequisites
- Node `>=22` and npm available.
- Network access for clone and dependency install.
- Local shell can run `npm test`.

## Abort conditions
- Clone or dependency installation fails.
- `npm test` fails during preflight verification.
- Any requested delivery mode requires upstream write-back.

## Start command
```bash
aor live-e2e start   --profile ./examples/live-e2e/regress-short.yaml
```

## Optional UI attach
```bash
aor ui attach --run RUN-201 --control-plane http://localhost:8080
```

## Expected verification
- install succeeds;
- `npm test` succeeds;
- handoff packet and step results are materialized;
- evidence and live events are available;
- no upstream write-back occurs.
