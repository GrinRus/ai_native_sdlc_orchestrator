# Live E2E no-write preflight procedure

This procedure is the reusable baseline for public-repo rehearsals across bootstrap, quality, and delivery-oriented flows.

## Safety invariants
- Upstream write-back stays disabled (`write_back_to_remote=false`) unless a fork/local mirror policy is explicitly approved.
- Preferred delivery mode stays in patch/local/fork-safe options.
- Rehearsal stops immediately when preflight safety gates fail.

## Preflight sequence
1. **Clone** target repository with the configured ref and checkout strategy.
2. **Inspect** repo shape, prerequisites, and local command ownership.
3. **Analyze** target topology and candidate verification commands.
4. **Validate** profile, refs, and policy defaults.
5. **Verify** bounded local commands.
6. **Stop** (or proceed to later stages only when all no-write gates pass).

## Bootstrap rehearsal procedure (W1 baseline)
Use this exact sequence when validating bootstrap flow readiness without delivery automation:

```bash
# AOR workspace target (expected verify success)
aor project init --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w1-s08-aor
aor project analyze --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w1-s08-aor
aor project validate --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w1-s08-aor
aor project verify --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w1-s08-aor --require-validation-pass

# Public target from catalog (sindresorhus/ky, safe-failure verify allowed)
aor project init --project-ref <KY_TARGET_ROOT> --project-profile <KY_TARGET_ROOT>/examples/project.aor.yaml
aor project analyze --project-ref <KY_TARGET_ROOT> --project-profile <KY_TARGET_ROOT>/examples/project.aor.yaml
aor project validate --project-ref <KY_TARGET_ROOT> --project-profile <KY_TARGET_ROOT>/examples/project.aor.yaml
aor project verify --project-ref <KY_TARGET_ROOT> --project-profile <KY_TARGET_ROOT>/examples/project.aor.yaml --require-validation-pass
```

Evidence fixtures captured for this procedure:
- `examples/live-e2e/fixtures/bootstrap-rehearsal/aor/*.json`
- `examples/live-e2e/fixtures/bootstrap-rehearsal/aor/runtime-tree.txt`
- `examples/live-e2e/fixtures/bootstrap-rehearsal/ky/*.json`
- `examples/live-e2e/fixtures/bootstrap-rehearsal/ky/runtime-tree.txt`

Observed baseline:
- AOR target completes validate `pass` and verify `passed`.
- `sindresorhus/ky` target keeps validate `pass` and verify `failed` safely with no upstream write-back.

Validation step output must materialize a deterministic `validation-report` with `pass`, `warn`, or `fail` status. When verify is started with validation gating enabled, a `fail` report blocks verify until the failing validators are resolved.

## Required target annotations
Each profile and runbook must provide:
- prerequisites;
- repo-shape notes;
- failure-safe defaults;
- abort conditions.

## Abort conditions
Abort the rehearsal when any of these conditions occur:
- checkout, setup, or dependency installation fails;
- required verification commands fail;
- a command path requires upstream write-back in a no-write rehearsal;
- budget limits are exceeded before safety gates pass.

## Reuse map for later waves
- **Bootstrap rehearsals:** reuse clone/inspect/analyze/validate/verify gating before packet materialization.
- **Quality rehearsals:** reuse verify success as a prerequisite for eval or harness execution.
- **Delivery rehearsals:** reuse no-write defaults while still allowing manifest/release packet materialization.

## Related artifacts
- Target catalog: `docs/ops/live-e2e-target-catalog.md`
- Profiles: `examples/live-e2e/*.yaml`
- Runbooks: `docs/ops/live-e2e-regress-short.md`, `docs/ops/live-e2e-regress-long.md`, `docs/ops/live-e2e-release-short.md`, `docs/ops/live-e2e-release-long.md`
