---
name: live-e2e-runner
description: Run authorized AOR live E2E rehearsals or assess existing run evidence through the black-box step journal.
---

# Live E2E runner

## Choose the mode

- For analysis, review, or diagnosis, inspect existing profiles, public artifacts,
  run-health, and controller evidence. Report gaps without starting, resuming,
  recording, or repairing a run. A missing result is a validation gap, not
  permission to make a paid provider call.
- For an authorized rehearsal, use the selected profile, provider, budgets,
  delivery policy, and stop conditions. Existing authorization covers only that
  scope. A blocker does not authorize credential changes, commits, changed
  safety settings, or additional paid attempts.
- For an authorized fix-and-rerun task, make the bounded local correction and
  deterministic checks first. Resume the same run only when its evidence is
  still valid; use a fresh run when the source or setup changed. Qualification
  evidence must match the required commit identity.

Read the relevant section of the
[standard runner runbook](../../../scripts/live-e2e/docs/runbooks/live-e2e-standard-runner.md):
`Manual step workflow`, `Step evaluator`, `Inspect`, `Run Health`, or
`Post-Run Quality Assessment`. Use the
[preflight procedure](../../../scripts/live-e2e/docs/runbooks/live-e2e-no-write-preflight.md)
to check preparation and the
[target catalog](../../../scripts/live-e2e/docs/runbooks/live-e2e-target-catalog.md)
to resolve a mission. Do not load the full catalog for a run whose cell is
already known.

## Operate the step loop

Use the manual entrypoint for skill-agent acceptance and production-proof
operation. Keep one stable run ID while completing its pending decisions:

```bash
node ./scripts/live-e2e/manual-live-e2e.mjs \
  --project-ref . --profile <profile> --run-id <stable-run-id>
```

1. Inspect the isolated installation proof, setup journal, current
   `step_journal[].plan`, decision request, public command transcripts, and linked
   artifacts before deciding. Execute target work only through public installed
   CLI/API/web surfaces; never repair target execution through private runtime
   calls or edits to proof state.
2. Classify deterministic evidence before semantic quality. An operator
   `continue` requires deterministic `pass`, `warn`, or `resumed`, a
   `skill-agent` semantic assessment, and evidence actually inspected. The
   decision helper can populate refs; it cannot perform that inspection for you.
3. Prepare and install the operator decision using the runbook's
   `--prepare-decision` and `--operator-decision-file` workflow. Answer requested
   interactions only through `aor run answer` or the public HTTP answer route,
   within the authorized task. Verify answer audit and terminal interaction
   status before resuming.
4. For `medium`, `large`, or manual-only `xlarge` product-change steps, inspect
   the linked step-quality request after the operator decision. Continuation
   also requires an accepted `live-e2e-step-quality-assessment-report` with
   step-specific rationale, findings, and public refs for each required
   dimension. Use `--prepare-step-quality` for the manual report, then resume
   the same run. An accepted operator decision alone does not close this gate.
5. For `browser-task-proof`, use the request's live `app_url` and its required
   screenshot, accessibility, and interaction evidence. `smoke_app_url` and
   `aor app --smoke` do not establish completed operator UX proof. Follow the
   runbook's proof-ref hydration procedure before continuing.
6. Stop or diagnose at a failed gate or exhausted budget. Inspect current
   durable provider status before treating a silent or stale observation as a
   terminal failure. Use public cancellation or retry surfaces for authorized
   interventions; preserve owner, phase, class, and partial evidence.

`run-profile.mjs` is the underlying proof orchestrator. `step-evaluator.mjs`
can drive the same controller automatically when its evaluator and run are
authorized; neither replaces missing evidence. Xlarge uses the manual loop and
must not enter the step evaluator or qualification sets.

## Assess and close

Inspect run-health before outcome quality. Keep target/environment/provider
blockers separate from AOR failures, and keep run-health separate from product
quality. A failed or incomplete flow cannot become a passing outcome assessment.

When assessment artifact creation is requested and a full flow is eligible,
follow the runbook's `quality-assessment.mjs prepare`, `validate`, and
`gate --policy all-pass` procedure. Reuse existing paired operator UI proof only
from the same AOR commit; report missing proof instead of launching another run
without authorization. Quality findings do not rewrite factual run-health.

For qualification, use the
[provider qualification runbook](../../../scripts/live-e2e/docs/runbooks/live-e2e-provider-qualification.md).
`qualification-loop.mjs` accepts medium or large profiles only. Record an
existing completed run with its final assessment when requested; record mode
writes qualification accounting but does not launch a new provider run. W66
requires the documented four cells on one AOR commit and one pinned target
commit. Xlarge is manual observation evidence, even when its quality passes.

Report run identity, source commit, run-health and blocker refs, controller and
repair-iteration evidence, step-quality acceptance, final quality gate, and the
applicable qualification disposition. Keep raw credential-bearing evidence
private. Internal rehearsal artifacts use the runner's isolated workspace or
explicit ignored `.aor/` output; product state uses the launcher-selected
`AOR_HOME`, not target-repository scratch paths.
