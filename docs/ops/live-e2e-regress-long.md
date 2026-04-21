# Runbook: live E2E — regress long

## Target
- Repository: `https://github.com/httpie/cli.git`
- Branch/ref: `master`
- Goal: deeper regression rehearsal on a Python CLI project

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

## Start command
```bash
aor live-e2e start   --profile ./examples/live-e2e/regress-long.yaml
```

## Expected verification
- repository bootstrap succeeds;
- `make all` or equivalent setup path succeeds;
- `make test` and `make codestyle` succeed;
- review and QA packets are materialized;
- release packet is not required.
