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
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/release-short.yaml
```

## Expected verification
- setup command `npm install` succeeds;
- setup command `npx playwright install` succeeds;
- `npm test` succeeds;
- release packet exists;
- delivery manifest exists;
- write-back target is patch, local branch, or fork.

## Post-run artifact inspection
Inspect the latest materialized artifacts:
```bash
ls -1 .aor/projects/<project_id>/artifacts/delivery-manifest-*.json | tail -n 1
ls -1 .aor/projects/<project_id>/artifacts/release-packet-*.json | tail -n 1
```
Confirm delivery lineage and approval context:
```bash
jq '.delivery_mode, .approval_context, .repo_deliveries[0].changed_paths' <delivery-manifest-file>
jq '.delivery_manifest_ref, .evidence_lineage' <release-packet-file>
```

## W4-S06 rehearsal findings
- short rehearsal keeps `patch-only` as the safest default for public targets;
- success path must preserve delivery manifest and release packet as durable JSON files;
- failure path must preserve transcript `recovery_steps` plus blocked release packet lineage.

Evidence fixtures for W4-S03 baseline:
- `examples/live-e2e/fixtures/w4-s03/delivery-patch.sample.patch`
- `examples/live-e2e/fixtures/w4-s03/delivery-local-branch-transcript.sample.json`

Evidence fixtures for W4-S06:
- `examples/live-e2e/fixtures/w4-s06/ky-release-short.delivery-manifest.sample.json`
- `examples/live-e2e/fixtures/w4-s06/ky-release-short.release-packet.sample.json`
- `examples/live-e2e/fixtures/w4-s06/public-target-delivery-rehearsal.sample.md`

Related runbook:
- `docs/ops/github-fork-first-delivery.md`
