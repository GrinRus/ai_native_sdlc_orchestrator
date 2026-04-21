# Harness certification baseline

## Purpose
Run a baseline certification flow that converts eval + harness evidence into a durable promotion decision artifact.

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
- `certification_evaluation_report_file`
- `certification_harness_capture_file`
- `certification_harness_replay_file`

## Certification transcript (example)
```json
{
  "command": "harness certify",
  "status": "implemented",
  "promotion_decision_status": "pass"
}
```

## Stop conditions
- certification status is `hold` or `fail`;
- harness replay reports compatibility mismatches;
- required evidence files were not generated.
