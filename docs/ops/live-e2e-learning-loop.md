# Runbook: live E2E learning-loop handoff

## Purpose
Turn live run artifacts into repeatable quality and backlog follow-up work.

## Inputs
- one `live_e2e_run_summary_file` emitted by `node ./scripts/live-e2e/run-profile.mjs`
- one `live_e2e_run_health_report_file` linked from that summary
- one validated `live-e2e-quality-assessment-report` when outcome quality follow-up is needed
- runtime root for the rehearsal (`.aor` by default)

## 1. Read durable run output
From `live_e2e_run_summary_file`, record:
- `run_id`
- `learning_loop_scorecard_file`
- `learning_loop_handoff_file`
- `live_e2e_run_health_report_file`
- `incident_report_file` (when status is `fail` or the profile forces incidents)

## 2. Inspect run health
Read `live_e2e_run_health_report_file` first. Classify follow-up for:
- command failures;
- controller gaps and missing operator decisions;
- provider execution issues;
- context-budget blockers, including `compiled_context_budget_exceeded`;
- target setup or verification environment issues;
- missing factual evidence refs;
- resume or interaction failures.

These are run-quality gaps. Keep them separate from code, artifact, AOR
operator UI/UX, or AOR operator accessibility quality.

## 3. Inspect outcome quality and evidence linkage
```bash
aor evidence show \
  --project-ref . \
  --run-id <RUN_ID>
```

Confirm:
- `live-e2e-quality-assessment-report` exists when backlog follow-up depends on outcome quality;
- quality assessment findings use the normalized taxonomy and cite inspected evidence refs;
- incident report (if present) links back to `linked_run_refs` and `linked_asset_refs`;
- handoff file preserves backlog and quality references.

When the run is part of a strict quality-driven closure loop, validate the
assessment and run the all-pass gate separately:

```bash
node ./scripts/live-e2e/quality-assessment.mjs validate \
  --assessment-report-file <live-e2e-quality-assessment-report>

node ./scripts/live-e2e/quality-assessment.mjs gate \
  --policy all-pass \
  --assessment-report-file <live-e2e-quality-assessment-report>
```

All-pass failures become backlog/fix-and-rerun findings. They must not mutate
the factual run-health report or provider qualification matrix.

## 4. Move findings into planning
Use `learning_loop_handoff_file` plus validated quality assessment findings as
the source for outcome planning updates:
- update `docs/backlog/mvp-implementation-backlog.md` only at slice granularity;
- update the owning wave document for local-task follow-up;
- link run-health follow-up to owner/phase/class;
- link outcome-quality follow-up to assessment finding categories such as
  `artifact-content`, `implementation-correctness`, `test-adequacy`,
  `security`, `performance`, `ui-ux`, `accessibility`, `evidence-gap`,
  `acceptance-traceability`, or `follow-up-needed`;
- link quality follow-up to suites/captures before enabling risky retries.

## 5. Close the loop
A run is learning-loop complete when:
- scorecard is durable;
- incident linkage is complete when incident exists;
- run-health follow-up is either resolved or intentionally parked;
- quality assessment findings that affect outcome readiness are linked to backlog follow-up;
- strict all-pass gate findings are resolved or intentionally parked when the run belongs to a quality-driven closure loop;
- backlog follow-up entry is explicit and traceable to the run id.

## Governance closure evidence
For wave-level closure checks, use a catalog-backed full-journey profile and confirm:
- handoff backlog refs include `docs/backlog/wave-7-implementation-slices.md`;
- quality evidence includes the post-run quality assessment plus promotion and harness artifacts;
- `aor audit runs --run-id <RUN_ID>` returns non-empty `incident_refs` and populated `finance_evidence`.
