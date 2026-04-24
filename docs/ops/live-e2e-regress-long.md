# Runbook: live E2E — regress long

## Target
- Repository: `https://github.com/httpie/cli.git`
- Branch/ref: `master`
- Goal: deeper regression rehearsal on a Python CLI project
- Repo shape note: make-driven Python CLI workflow with pytest-based checks

## When to use it
- after routing or harness changes that need stronger evidence;
- after quality-gate changes;
- when a short TypeScript-only target is not enough.

## Objective
Confirm that AOR can:
- bootstrap a non-TypeScript repository;
- handle a longer local setup path;
- execute a bounded implementation task with tests;
- produce stronger review and QA evidence.

## Default task brief
1. Run repository analysis and verify setup.
2. Use the documented `make`-based workflow.
3. Implement one bounded fix or improvement in a CLI surface.
4. Verify with `make test` and `make codestyle`.
5. Stop at patch or fork branch unless explicitly configured otherwise.

## No-write preflight
Use `docs/ops/live-e2e-no-write-preflight.md` and keep the sequence explicit:
1. clone
2. inspect
3. analyze
4. validate
5. verify
6. stop unless no-write gates pass

Isolation mode defaults:
- prefer `worktree` when rehearsing local-branch delivery behavior;
- prefer `workspace-clone` when rehearsing fork-first delivery behavior on public targets.

## Prerequisites
- Python 3 available.
- `make` is available in the local shell.
- Network access for clone and dependency install.

## Abort conditions
- Clone or setup path fails.
- `make test` fails during preflight verification.
- `make codestyle` fails during preflight verification.
- Any requested delivery mode requires upstream write-back.

## Harness command
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/regress-long.yaml
```

## Expected verification
- repository bootstrap succeeds;
- setup command `make install` succeeds;
- `make test` and `make codestyle` succeed;
- review and QA packets are materialized;
- release packet is not required.
