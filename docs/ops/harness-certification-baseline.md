# Harness certification baseline

## Purpose
Run a baseline certification flow that converts deterministic validation + eval + harness evidence into a durable promotion decision artifact with explicit governance guardrails.

This is an Asset Certification Capability, not the internal AOR Runtime Harness and not completed-run diagnosis. The command creates fresh certification evidence for platform asset lifecycle decisions. It may link to a run for provenance, but `runtime-harness-report` owns run diagnosis and learning-loop artifacts own follow-up closure.

## Command
```bash
aor harness certify \
  --project-ref <PROJECT_ROOT> \
  --asset-ref wrapper://wrapper.eval.default@v1 \
  --subject-ref wrapper://wrapper.eval.default@v1 \
  --suite-ref suite.cert.core@v4 \
  --step-class implement
```

Public promote/freeze surfaces:
```bash
aor asset promote \
  --project-ref <PROJECT_ROOT> \
  --asset-ref wrapper://wrapper.eval.default@v1 \
  --subject-ref wrapper://wrapper.eval.default@v1 \
  --suite-ref suite.cert.core@v4
```

```bash
aor asset freeze \
  --project-ref <PROJECT_ROOT> \
  --asset-ref wrapper://wrapper.eval.default@v1 \
  --subject-ref wrapper://wrapper.eval.default@v1 \
  --suite-ref suite.cert.core@v4
```

Compiler revision lifecycle surface:
```bash
aor compiler revision \
  --project-ref <PROJECT_ROOT> \
  --compiler-revision-ref compiler-revision://runtime-context-compiler@v1 \
  --action inspect
```

`aor asset promote` and `aor asset freeze` can use a `compiler-revision://...` asset ref to produce both a `promotion-decision` and a linked `compiler-revision-status` report. Direct `aor compiler revision --action promote|freeze|demote` requires an existing `--promotion-decision-ref`; without that evidence it writes a blocked status rather than claiming lifecycle readiness.

## Expected output fields
- `promotion_decision_id`
- `promotion_decision_file`
- `promotion_decision_status` (`pass|hold|fail`)
- `promotion_from_channel`
- `promotion_to_channel`
- `promotion_rollout_action` (`promote|hold|reject|freeze|demote`)
- `promotion_governance_checks`
- `validation_report_file` (inside promotion-decision evidence refs)
- `certification_evaluation_report_file`
- `certification_harness_capture_file`
- `certification_harness_replay_file`
- `compiler_revision_status_file` and `compiler_revision_decision_history` when the certified asset is a compiler revision
- `baseline_comparison.*` for stable/frozen/demoted transitions

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

Freeze escalation flow (regression-backed):
```json
{
  "command": "harness certify --from-channel stable --to-channel frozen",
  "promotion_decision_status": "fail",
  "rollout_action": "freeze",
  "freeze_guardrail_satisfied": true
}
```

## Stop conditions
- certification status is `hold` or `fail`;
- harness replay reports compatibility mismatches;
- deterministic validation status is `warn` or `fail`;
- finance signals are incomplete in promotion decision evidence summary;
- baseline comparison evidence is missing for `stable|frozen|demoted` transitions;
- freeze transition is requested without explicit regression evidence;
- required evidence files were not generated.
