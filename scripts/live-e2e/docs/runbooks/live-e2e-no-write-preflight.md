# Live E2E no-write preflight procedure

Use this procedure before an internal installed-user rehearsal. The maintained
execution procedure is `scripts/live-e2e/docs/runbooks/live-e2e-standard-runner.md`;
this preflight establishes target, storage, profile, and verification boundaries.

## Safety and storage

- Keep upstream write-back disabled (`write_back_to_remote=false`). Select the
  profile's explicit delivery mode; `no-write` smoke does not authorize a later
  source change.
- Use a disposable target checkout and isolated `AOR_HOME`. Product runtime
  state belongs in AOR Home, not the target repository.
- Keep generated profiles, operator decisions, inputs, and private transcripts
  in the maintainer run's ignored output directory. Do not inject examples,
  route overrides, or runtime scaffolding into the target checkout.
- Public `aor` commands do not accept `--runtime-root`. Pass `AOR_HOME` through
  the environment to isolate public command state.

## Credential-free installation smoke

Run from a neutral directory using the installed package:

```bash
AOR_REHEARSAL_HOME="$(mktemp -d)"
AOR_HOME="$AOR_REHEARSAL_HOME" aor doctor \
  --project-ref /path/to/disposable-target \
  --json
AOR_HOME="$AOR_REHEARSAL_HOME" aor app \
  --project-ref /path/to/disposable-target \
  --smoke --open false --json
```

`doctor` reports environment and repository blockers. App smoke must return
`status: "smoke-pass"` without creating repo-local `.aor` or changing target
HEAD/status. It checks package and transport readiness; it does not certify
provider execution or the complete installed Task lifecycle.

## Profile and target checks

1. Resolve `target_catalog_id` and `feature_mission_id` from
   `scripts/live-e2e/catalog/targets/*.yaml`. Pin the target revision and inspect
   repository shape, tool prerequisites, and verification commands.
2. Check the profile's flow range, installation policy, operator/interaction
   policies, frontend capability, implementation repair budget, and
   `no-upstream-write` safety policy using `.agents/skills/live-e2e-preflight/SKILL.md`.
3. Keep the generated profile and bootstrap assets outside the target checkout.
   Full-journey execution uses the installed public CLI/API/web boundary.
4. Inspect setup, readiness, and verification evidence before continuing.
   Required command failures block. Baseline diagnostics remain distinguishable
   from post-run verification; follow the profile's declared enforcement mode.
5. For provider qualification, satisfy the W71-S14 freeze prerequisite in
   `docs/ops/w66-qualification-freeze.md` before starting any W66-S09 cell.

## Abort conditions

Stop when target checkout or setup fails, required tools or authorization are
missing, required verification fails, command or path ownership is ambiguous,
upstream writes would be required, or the declared execution budget is exhausted.
Preserve the run's existing evidence and report the owning blocker before retry.
Do not turn a setup/provider failure into a passing product-quality verdict.

## Follow-up procedures

- Full-journey execution and operator decisions:
  `scripts/live-e2e/docs/runbooks/live-e2e-standard-runner.md`.
- Target requirements and verification policy:
  `scripts/live-e2e/docs/runbooks/live-e2e-target-catalog.md`.
- Quality assessment:
  `scripts/live-e2e/docs/runbooks/live-e2e-quality-rehearsal.md`.
- Operator-request lifecycle: `docs/ops/ui-attach-detach.md`.
- Delivery boundaries: `docs/ops/github-fork-first-delivery.md`.
- Bounded multirepo component proof: `docs/ops/repo-aware-execution-proof.md`.

## Historical evidence

Retained bootstrap samples are indexed by
`scripts/live-e2e/fixtures/evidence/bootstrap-rehearsal/README.md`. They describe
the pre-W67 storage layout and do not prove the current installed journey.
Historical W10 and W32 samples remain under
`scripts/live-e2e/fixtures/evidence/w10-s01/` and
`scripts/live-e2e/fixtures/evidence/w32-s01/`. Reproduction of current behavior
must use the current public commands and declared profile, not old transcript
paths or synthetic evidence references.
