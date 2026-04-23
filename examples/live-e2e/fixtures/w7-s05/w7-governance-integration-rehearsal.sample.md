# W7-S05 governance integration rehearsal transcript (sample)

## Run
- Profile: `scripts/live-e2e/profiles/w7-governance-integration.yaml`
- Run id: `live-e2e.w7.governance.integration.run-202604221230`
- Status: `pass`

## Linked closure evidence
1. Quality governance evidence:
   - `evaluation-report-suite.release.short-v1-*.json`
   - `harness-capture-aor-core.harness.capture.*.json`
   - `harness-replay-aor-core.harness.replay.*.json`
   - `promotion-decision-wrapper-wrapper.eval.default-v1-*.json`
2. Incident evidence:
   - `incident-report-aor-core.incident.live-e2e.w7.governance.integration.run-202604221230.*.json`
3. Finance evidence:
   - `promotion decision -> evidence_summary.finance_signals`
   - `audit runs -> run_audit_records[0].finance_evidence`
4. Learning-loop handoff:
   - `learning-loop-scorecard-live-e2e-live-e2e.w7.governance.integration.run-202604221230.json`
   - `learning-loop-handoff-live-e2e.w7.governance.integration.run-202604221230-*.json`

## Wave-level smoke
- `aor audit runs --project-ref . --run-id live-e2e.w7.governance.integration.run-202604221230`
- Result: `incident_refs > 0`, `promotion_refs > 0`, `finance_evidence` populated.
