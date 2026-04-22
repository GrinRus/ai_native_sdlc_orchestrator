# Harness certification baseline

## Purpose
Run a baseline certification flow that converts deterministic validation + eval + harness evidence into a durable promotion decision artifact with explicit governance guardrails.

## Command
```bash
aor harness certify \
  --project-ref <PROJECT_ROOT> \
  --asset-ref wrapper://wrapper.eval.default@v1 \
  --subject-ref wrapper://wrapper.eval.default@v1 \
  --suite-ref suite.cert.core@v4 \
  --step-class implement
```

## Expected output fields
- `promotion_decision_id`
- `promotion_decision_file`
- `promotion_decision_status` (`pass|hold|fail`)
- `validation_report_file` (inside promotion-decision evidence refs)
- `certification_evaluation_report_file`
- `certification_harness_capture_file`
- `certification_harness_replay_file`

## Certification transcripts (examples)
Approved flow:
```json
{
  "command": "harness certify",
  "status": "implemented",
  "promotion_decision_status": "pass"
}
```

Policy-blocked flow:
```json
{
  "command": "harness certify",
  "status": "implemented",
  "promotion_decision_status": "fail",
  "governance_check": "policy-quality-gate",
  "blocked_reason": "Policy quality gate blocked by failing governance checks."
}
```
Reference sample: `examples/eval/governance-certification-transcript.sample.json`.

## Stop conditions
- certification status is `hold` or `fail`;
- harness replay reports compatibility mismatches;
- deterministic validation status is `warn` or `fail`;
- finance signals are incomplete in promotion decision evidence summary;
- required evidence files were not generated.
