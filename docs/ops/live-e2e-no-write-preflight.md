# Live E2E no-write preflight procedure

This procedure is the reusable baseline for public-repo rehearsals across bootstrap, quality, and delivery-oriented flows.

## Safety invariants
- Upstream write-back stays disabled (`write_back_to_remote=false`) unless a fork/local mirror policy is explicitly approved.
- Preferred delivery mode stays in patch/local/fork-safe options.
- Rehearsal stops immediately when preflight safety gates fail.

## Isolation mode guidance (W4-S01)
Choose runtime workspace isolation explicitly through `project-profile.runtime_defaults.workspace_mode`:

- `ephemeral` — run in the primary checkout. Use for bootstrap-only no-write smoke where delivery mutation is not attempted.
- `workspace-clone` — run in an isolated filesystem clone. Recommended for patch-only and fork-first delivery rehearsals.
- `worktree` — run in an isolated worktree-style root. Recommended for local-branch delivery rehearsals.

Cleanup policy is controlled by `runtime_defaults.workspace_cleanup`:
- `on_success`, `on_abort`, `on_failure` each accept `delete`, `retain`, or `none`.
- Default behavior for isolated roots is `delete` on success/abort and `retain` on failure.
- Default behavior for `ephemeral` mode is `none` for all outcomes.

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

## Routed rehearsal procedure (W2-S06 baseline)
Use this bounded no-write rehearsal to prove routed execution path readiness (route + asset + policy + adapter) before delivery automation:

```bash
aor project init --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
aor project analyze --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
aor handoff prepare --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
aor handoff approve --project-ref <AOR_WORKSPACE> --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --handoff-packet <AOR_WORKSPACE>/.aor/w2-s06-rehearsal/projects/aor-core/artifacts/aor-core.handoff.bootstrap.v1.json --approval-ref approval://W2-S06-REHEARSAL
aor project validate --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --require-approved-handoff --handoff-packet <AOR_WORKSPACE>/.aor/w2-s06-rehearsal/projects/aor-core/artifacts/aor-core.handoff.bootstrap.v1.json
aor project verify --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --require-validation-pass --routed-dry-run-step implement
```

Expected routed rehearsal signals:
- `handoff approve` returns `handoff_status=approved`;
- validation handoff gate returns `pass`;
- `project verify` materializes `routed_step_result_file`;
- `step-result-routed-implement.json` contains route, asset, policy, and adapter resolution metadata with `mode=dry-run`.

Evidence fixtures captured for this procedure:
- `examples/live-e2e/fixtures/routed-rehearsal/aor/routed-rehearsal-transcript.md`
- `examples/live-e2e/fixtures/routed-rehearsal/aor/project-verify-routed.json`
- `examples/live-e2e/fixtures/routed-rehearsal/aor/step-result-routed-implement.json`
- `examples/live-e2e/fixtures/routed-rehearsal/aor/runtime-tree.txt`

## Quality rehearsal procedure (W3-S06 baseline)
Use this baseline on selected public targets after no-write preflight gates pass:

```bash
aor eval run --project-ref <TARGET_ROOT> --project-profile <TARGET_ROOT>/examples/project.aor.yaml --suite-ref suite.regress.short@v1 --subject-ref run://<target-id>
aor harness certify --project-ref <TARGET_ROOT> --project-profile <TARGET_ROOT>/examples/project.aor.yaml --asset-ref wrapper://wrapper.runner.default@v3 --subject-ref run://<target-id> --suite-ref suite.regress.short@v1 --step-class implement
```

Expected quality rehearsal signals:
- eval output returns `evaluation_status=pass`;
- certification output returns `promotion_decision_status=pass`;
- evaluation report, harness capture/replay, and promotion decision files are all materialized.

Evidence fixtures captured for this procedure:
- `examples/live-e2e/fixtures/w3-s06/ky-eval.json`
- `examples/live-e2e/fixtures/w3-s06/ky-certify.json`
- `examples/live-e2e/fixtures/w3-s06/httpie-cli-eval.json`
- `examples/live-e2e/fixtures/w3-s06/httpie-cli-certify.json`
- `examples/live-e2e/fixtures/w3-s06/artifacts/ky/*`
- `examples/live-e2e/fixtures/w3-s06/artifacts/httpie-cli/*`

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
- routed dry-run step result status is `failed`;
- budget limits are exceeded before safety gates pass.

## Reuse map for later waves
- **Bootstrap rehearsals:** reuse clone/inspect/analyze/validate/verify gating before packet materialization.
- **Quality rehearsals:** reuse verify success as a prerequisite for eval or harness execution.
- **Delivery rehearsals:** reuse no-write defaults while still allowing manifest/release packet materialization.

## Related artifacts
- Target catalog: `docs/ops/live-e2e-target-catalog.md`
- Profiles: `examples/live-e2e/*.yaml`
- Quality rehearsal runbook: `docs/ops/live-e2e-quality-rehearsal.md`
- Runbooks: `docs/ops/live-e2e-regress-short.md`, `docs/ops/live-e2e-regress-long.md`, `docs/ops/live-e2e-release-short.md`, `docs/ops/live-e2e-release-long.md`
