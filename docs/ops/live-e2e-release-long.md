# Runbook: live E2E — release long

## Target
- Repository: `https://github.com/belgattitude/nextjs-monorepo-example.git`
- Branch/ref: `main`
- Goal: long release rehearsal on a representative monorepo
- Repo shape note: Next.js/Turborepo monorepo with apps and shared packages

## When to use it
- before promoting high-impact route, wrapper, or adapter changes;
- when multirepo or monorepo impact analysis must be exercised;
- when a delivery-manifest flow needs stronger evidence.

## Objective
Confirm that AOR can:
- bootstrap a workspace repo with apps and packages;
- plan a bounded cross-package change;
- run mission-scoped monorepo quality checks;
- materialize delivery and release artifacts for a fork or local mirror.

## Default task brief
1. Analyze repo topology and detect the package/app graph.
2. Modify one shared package plus one consuming app or package.
3. Verify with workspace lint, typecheck, and unit tests.
4. Materialize release packet and delivery manifest.
5. Stop at patch, local branch, or fork PR draft.

## No-write preflight
Use `docs/ops/live-e2e-no-write-preflight.md` and keep the sequence explicit:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. stop unless no-write gates pass

## Prerequisites
- Node + yarn available.
- Network access for clone and workspace install.
- Shell resources suitable for workspace lint/typecheck/test commands.

## Abort conditions
- Clone or workspace installation fails.
- `yarn g:lint`, `yarn g:typecheck`, or shared-package unit smoke fails in preflight.
- Delivery or release stage requests upstream write-back.

## Harness command
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/release-long.yaml
```

## Expected verification
- bootstrap and install succeed;
- setup command `yarn install --immutable` succeeds;
- `yarn g:lint`, `yarn g:typecheck`, `yarn workspace @your-org/ts-utils test-unit`, and `yarn workspace @your-org/core-lib test-unit` succeed;
- impacted-repo and changed-path metadata are recorded;
- release packet and delivery manifest are materialized.

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
- long rehearsal uses `fork-first-pr` as the default bounded delivery mode for public monorepo targets;
- success path must preserve delivery manifest and release packet lineage for later audit;
- failure path must preserve transcript recovery instructions and blocked release packet status.

Evidence fixtures for W4-S06:
- `examples/live-e2e/fixtures/w4-s06/nextjs-release-long.delivery-transcript-failure.sample.json`
- `examples/live-e2e/fixtures/w4-s06/nextjs-release-long.release-packet-failure.sample.json`
- `examples/live-e2e/fixtures/w4-s06/public-target-delivery-rehearsal.sample.md`

Related runbook:
- `docs/ops/github-fork-first-delivery.md`
