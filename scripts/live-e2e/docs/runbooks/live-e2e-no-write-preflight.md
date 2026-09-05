# Live E2E no-write preflight procedure

This is the preparation checklist for current catalog-backed full journeys and
installed-user guided proof. It supports profile review without a live run and
preparation within an authorized rehearsal. Use the
[standard runner](live-e2e-standard-runner.md) for exact launch and continuation
commands and the [target catalog](live-e2e-target-catalog.md) for the selected
mission's prerequisites and command ownership.

## Review before running

Inspect the selected profile and catalog cell first. Record:

- target and mission identity, provider variant, feature size, and run tier;
- source-install policy, source/target commit requirements, and workspace mode;
- setup, baseline, primary post-run, and diagnostic commands and their owners;
- provider, command, iteration, and change budgets;
- delivery policy, public interaction and browser-proof requirements;
- required operator decisions, step-quality reports, and terminal evidence.

Review or diagnosis alone does not start a provider process, clone a target, or
install its dependencies. A run request authorizes preparation only within its
selected scope and budgets. Missing credentials or readiness are blockers to
report; changing credentials, permissions, or paid attempt budgets requires
applicable authorization. Keep `output_policy.write_back_to_remote=false`.
A fork-shaped delivery plan does not authorize publication.

Small missions are flow-regression canaries. Medium and large product-change
missions may contribute to qualification under the
[current provider qualification rules](live-e2e-provider-qualification.md).
Xlarge is manual observation only and cannot enter the step evaluator or
qualification sets. Medium, large, and xlarge product-change steps all require
accepted step-quality reports before continuation; final product quality uses
a separate all-pass assessment.

## Installed-user preparation

During an authorized run, let the proof runner own this sequence and inspect
its evidence before allowing product execution:

1. Prove the installed AOR launcher. Source-channel acceptance uses an isolated
   source install and records install, build, `aor --help`, and
   `aor project init --help` results. A supplied binary must pass the required
   launcher proof. `--runtime-root` and `--aor-install-mode repo-local` are
   explicit dev/debug overrides, not acceptance defaults.
2. Materialize the catalog target at its selected ref in the disposable
   checkout. Check target identity, toolchain prerequisites, and initial
   checkout cleanliness. Do not repair the original repository to make a
   rehearsal pass.
3. Prepare the feature request and generated profiles/assets in host-side
   run-scoped state. Bootstrap through public installed `aor project init`
   using those assets. Do not copy AOR examples, context, route overrides,
   root project configuration, or provider-home state into the target.
4. Run and inspect target setup, public analysis, validation, baseline
   verification, and routed dry-run evidence in the runner's prescribed order.
   Setup, validation, missing dry-run evidence, and unsafe write-back block
   execution. Full-journey baseline verification is diagnostic unless the
   profile declares `verification.baseline_gate.mode=blocking`; preserve the
   actual failure rather than treating a diagnostic exception as a pass.
5. Inspect real adapter readiness before provider execution. The readiness
   probe may itself call the paid provider and uses the authorized auth and
   permission mode. It must not recursively launch another provider CLI.
   Missing runtime/auth, failed edit or permission probes, and exhausted budgets
   stop execution with classified evidence.
6. Continue through the public lifecycle only after the current controller
   decision and any required step-quality gate are accepted. Use public
   interaction, cancellation, and retry surfaces. A repair or retry remains
   bounded by the existing task authorization and profile budget.

Production-proof candidates additionally require a blocking baseline gate,
packaged bootstrap assets, real external-process readiness, and safe patch or
local-branch delivery. A historical fixture is not fresh qualification proof.

## Runtime and evidence ownership

The proof runner stores its own transcripts, summaries, generated assets, and
target checkouts in its isolated workspace. An explicitly selected ignored
`.aor/` root may hold internal rehearsal artifacts. Its session launcher sets
an isolated `AOR_HOME` for mutable product state; ordinary installed operation
uses `${AOR_HOME:-$HOME/.aor}`. These are different storage concerns.

Before provider execution, only runner-permitted `.aor/` preparation files may
appear in the disposable target checkout. This narrow rehearsal allowance does
not move product state into the target or permit arbitrary scaffolding. Use
reported artifact refs and installation/session evidence rather than assuming
all reports share a target-local path. Keep generated state and raw transcripts
out of commits.

## Abort and handoff

Stop at failed setup or required verification, unsafe delivery policy, failed
adapter readiness, missing controller or quality evidence, or exhausted budget.
Keep run-health owner, phase, and failure class distinct from outcome-quality
findings. Post-run primary verification and required diagnostics still need
factual evidence even when baseline verification was diagnostic.

Report the selected cell, attempted preparation, inspected evidence, readiness
gaps, current decision, and next authorized action. A failed or incomplete flow
cannot be promoted by manually changing reports or by reusing unrelated proof.

## Historical rehearsal evidence

W1/W2 bootstrap and routed rehearsal command sequences were removed from this
active procedure because they depended on old target-local example assets and
fixture directories that are no longer present. They are not current executable
instructions or live acceptance inputs.

Retained sanitized snapshots under
`scripts/live-e2e/fixtures/evidence/bootstrap-rehearsal/ky/` and the W3, W4,
W10, and W32 fixture directories document their original wave only. Interpret
them with the owning historical wave and fixture notes. Current acceptance uses
the installed-user sequence above, the standard runner's public step journal,
and fresh evidence required by the selected qualification policy.
