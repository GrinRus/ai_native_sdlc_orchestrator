# Runbook: live E2E — release short

## Target
- Repository: `https://github.com/sindresorhus/ky.git`
- Branch/ref: `main`
- Goal: short release-shaped rehearsal on a small library
- Repo shape note: single-package TypeScript library with npm-first verification

## When to use it
- before promoting a wrapper, route, or adapter change;
- when the team needs a release packet signal without a large monorepo run;
- when delivery-manifest behavior must be checked quickly.

## Objective
Run the full flow through delivery preparation and release-packet materialization while keeping the code change narrow.

## Default task brief
1. Execute the same bounded change style as `regress short`.
2. Require review and QA.
3. Materialize a delivery manifest and release packet.
4. Keep upstream write-back disabled unless a fork is configured.

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
- Delivery or release step requires upstream write-back.

## Local-branch recovery baseline (W4-S03)
When local-branch delivery fails mid-run:
1. Open the latest `delivery-transcript-local-branch-*.json` under `.aor/projects/<project_id>/reports/`.
2. Checkout the original branch recorded in `git.head_before.branch`.
3. Inspect the transcript `error` and `recovery_steps` fields before retrying.
4. Delete temporary delivery branch only after confirming no required commit/evidence is on it.
5. If retrying in same workspace, rerun no-write preflight before a second local-branch attempt.

## Start command
```bash
aor live-e2e start   --profile ./examples/live-e2e/release-short.yaml
```

## Expected verification
- `npm test` succeeds;
- release packet exists;
- delivery manifest exists;
- write-back target is patch, local branch, or fork.

Evidence fixtures for W4-S03 baseline:
- `examples/live-e2e/fixtures/w4-s03/delivery-patch.sample.patch`
- `examples/live-e2e/fixtures/w4-s03/delivery-local-branch-transcript.sample.json`
