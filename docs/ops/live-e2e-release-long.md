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
- run workspace-wide checks;
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
- Node + corepack + yarn available.
- Network access for clone and workspace install.
- Shell resources suitable for workspace lint/typecheck/test commands.

## Abort conditions
- Clone or workspace installation fails.
- `yarn g:lint`, `yarn g:typecheck`, or `yarn g:test-unit` fails in preflight.
- Delivery or release stage requests upstream write-back.

## Start command
```bash
aor live-e2e start   --profile ./examples/live-e2e/release-long.yaml
```

## Expected verification
- bootstrap and install succeed;
- `yarn g:lint`, `yarn g:typecheck`, and `yarn g:test-unit` succeed;
- impacted-repo and changed-path metadata are recorded;
- release packet and delivery manifest are materialized.

Related runbook:
- `docs/ops/github-fork-first-delivery.md`
