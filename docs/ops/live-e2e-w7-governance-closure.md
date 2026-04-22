# Runbook: live E2E W7 governance closure rehearsal

## Purpose
Run one repeatable rehearsal that links W7 quality governance evidence, incident context, and finance-oriented promotion evidence under a single run id.

## Profile
Use `examples/live-e2e/w7-governance-integration.yaml`.

This profile keeps no-write safety defaults, forces learning-loop incident materialization, and emits release-shaped artifacts for closure audit review.

## Start
```bash
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/w7-governance-integration.yaml
```

## Verify integrated closure evidence
1. Read the run summary from `live_e2e_run_summary_file`.
2. Confirm these files exist and point to the same run id:
   - `learning_loop_scorecard_file`
   - `learning_loop_handoff_file`
   - `incident_report_file`
3. Confirm promotion artifacts exist in `artifacts`:
   - `promotion_decision_file`
   - `promotion_harness_capture_file`
   - `promotion_harness_replay_file`
4. Confirm release-shaped artifacts exist:
   - `delivery_manifest_file`
   - `release_packet_file`

## Wave-level smoke check
```bash
aor audit runs \
  --project-ref . \
  --run-id <RUN_ID>
```

Expected smoke signals:
- `run_audit_records[0].quality_refs` includes promotion and evaluation evidence.
- `run_audit_records[0].incident_refs` is non-empty.
- `run_audit_records[0].finance_evidence` contains budget or latency samples.

## Closure mapping
Use the learning-loop handoff and audit output to update:
- `docs/backlog/mvp-implementation-backlog.md`
- `docs/backlog/wave-7-implementation-slices.md`

Record the closure evidence bundle under `examples/live-e2e/fixtures/w7-s05/`.
