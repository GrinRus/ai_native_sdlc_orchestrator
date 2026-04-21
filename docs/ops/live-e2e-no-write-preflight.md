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
