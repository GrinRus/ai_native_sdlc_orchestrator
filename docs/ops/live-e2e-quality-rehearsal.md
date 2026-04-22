# Runbook: live E2E — quality rehearsal baseline

## Purpose
Validate the quality stack on public targets by running:
1. offline eval (`aor eval run`);
2. harness-based certification (`aor harness certify`).

This runbook captures the W3-S06 baseline rehearsal on two targets from the catalog.

## Targets exercised
- `sindresorhus/ky` (short regression target)
- `httpie/cli` (long regression target)

## Commands used
```bash
# Target-specific values: PROJECT_ROOT, PROJECT_PROFILE, SUBJECT_REF
aor eval run \
  --project-ref <PROJECT_ROOT> \
  --project-profile <PROJECT_PROFILE> \
  --suite-ref suite.regress.short@v1 \
  --subject-ref <SUBJECT_REF>

aor harness certify \
  --project-ref <PROJECT_ROOT> \
  --project-profile <PROJECT_PROFILE> \
  --asset-ref wrapper://wrapper.runner.default@v3 \
  --subject-ref <SUBJECT_REF> \
  --suite-ref suite.regress.short@v1 \
  --step-class implement
```

## Evidence fixtures
Transcripts:
- `examples/live-e2e/fixtures/w3-s06/ky-eval.json`
- `examples/live-e2e/fixtures/w3-s06/ky-certify.json`
- `examples/live-e2e/fixtures/w3-s06/httpie-cli-eval.json`
- `examples/live-e2e/fixtures/w3-s06/httpie-cli-certify.json`

Artifact set:
- `examples/live-e2e/fixtures/w3-s06/artifacts/ky/*`
- `examples/live-e2e/fixtures/w3-s06/artifacts/httpie-cli/*`

## Observed outcomes
- Both targets produced `evaluation_status=pass`.
- Both targets produced `promotion_decision_status=pass`.
- Eval, harness capture, harness replay, and promotion decision artifacts were materialized and copied into fixture storage.

## Per-target caveats
- `sindresorhus/ky`: repository itself does not include AOR `examples/**`; rehearsal required local profile/template injection before running quality commands.
- `httpie/cli`: same profile/template injection requirement; Python-specific project setup is not required for the offline quality baseline because scoring is runner-mock-based.

## Runtime cost notes
- Observed command latency in this baseline is low (seconds, not minutes) because eval + harness certification currently use offline deterministic/judge scoring with mock runner.
- Cost and latency can increase significantly once live adapter execution replaces mock-based quality rehearsal.

## Safe abort conditions
Stop rehearsal immediately when:
- target clone fails;
- AOR profile/template injection fails;
- `aor eval run` returns non-zero or `evaluation_status!=pass`;
- `aor harness certify` returns non-zero or `promotion_decision_status!=pass`;
- expected evidence files are missing after command completion.
