# Runbook: security route-governance checks

## Scope
Use this runbook when delivery/release planning must prove policy governance before write-back (`patch-only`, `local-branch`, `fork-first-pr`).

## Inputs
- project profile (`examples/project.aor.yaml` or project-specific override)
- resolved route/policy for target step class (`implement` by default)
- optional handoff and promotion evidence refs

## Command flow
```bash
aor deliver prepare \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID> \
  --mode fork-first-pr \
  --approved-handoff-ref evidence://handoff/approved \
  --promotion-evidence-refs evidence://promotion/pass
```

## What to inspect
- `delivery_governance_decision.decision`:
  - `allow` — governance checks passed for planned write-back mode.
  - `deny` — write-back is blocked by allowlist/policy violations.
  - `escalate` — write-back is blocked pending explicit security/compliance review.
- `delivery_blocking_reasons[]` for machine-readable reason codes.
- `delivery_plan_file` for durable governance snapshot and evidence lineage.

## Expected deny/escalation codes
- `provider-not-allowlisted`
- `adapter-not-allowlisted`
- `high-risk-security-review-required`
- `high-risk-human-approval-required`

## Release precondition behavior
- `aor release prepare` must fail fast when governance decision is `deny` or `escalate`.
- Failure must include explicit reason codes from `delivery_blocking_reasons`.
