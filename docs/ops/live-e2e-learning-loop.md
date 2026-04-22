# Runbook: live E2E learning-loop handoff

## Purpose
Turn live run artifacts into repeatable quality and backlog follow-up work.

## Inputs
- one run id from `aor run status` or `aor live-e2e report`
- runtime root for the rehearsal (`.aor` by default)

## 1. Read durable run output
```bash
aor live-e2e report \
  --project-ref . \
  --run-id <RUN_ID>
```

From `live_e2e_run_summary_file`, record:
- `learning_loop_scorecard_file`
- `learning_loop_handoff_file`
- `incident_report_file` (when status is `fail` or `aborted`)

## 2. Inspect quality and evidence linkage
```bash
aor evidence show \
  --project-ref . \
  --run-id <RUN_ID>
```

Confirm:
- quality artifacts include validation/evaluation output;
- incident report (if present) links back to `linked_run_refs` and `linked_asset_refs`;
- handoff file preserves backlog and quality references.

## 3. Move findings into planning
Use `learning_loop_handoff_file` as the source for planning updates:
- update `docs/backlog/mvp-implementation-backlog.md` only at slice granularity;
- update the owning wave document for local-task follow-up;
- link quality follow-up to suites/captures before enabling risky retries.

## 4. Close the loop
A run is learning-loop complete when:
- scorecard is durable;
- incident linkage is complete when incident exists;
- backlog follow-up entry is explicit and traceable to the run id.
