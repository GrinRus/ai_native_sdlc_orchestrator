# Contracts index

## Core packets and profiles
- `project-profile.md`
- `onboarding-report.md`
- `next-action-report.md`
- `project-analysis-report.md`
- `discovery-research-report.md`
- `artifact-packet.md`
- `intake-request-body.md`
- `wave-ticket.md`
- `handoff-packet.md`
- `release-packet.md`
- `delivery-plan.md`
- `delivery-manifest.md`
- `incident-report.md`

## Execution and quality
- `step-result.md`
- `validation-report.md`
- `evaluation-report.md`
- `review-report.md`
- `review-decision.md`
- `runtime-harness-report.md`
- `live-e2e-observation-report.md`
- `live-e2e-run-health-report.md`
- `live-e2e-quality-assessment-report.md`
- `live-e2e-step-quality-assessment-request.md`
- `live-e2e-step-quality-assessment-report.md`
- `multirepo-coordination-status.md`
- `incident-backfill-proposal.md`
- `dataset.md`
- `evaluation-suite.md`
- `promotion-decision.md`
- `compiled-context-artifact.md`
- `operator-request.md`

Compiled-context and external-runner contracts include context-budget evidence for live adapter-backed steps. Live E2E run-health consumes those facts as run-quality failures only; per-step product quality starts with `live-e2e-step-quality-assessment-request`, is accepted or blocked by `live-e2e-step-quality-assessment-report`, and final outcome quality remains in `live-e2e-quality-assessment-report`. For medium+ product-change missions, accepted linked step-quality reports and all-pass final quality are mandatory for product acceptance, while provider qualification remains a separate policy.

## Platform assets
- `provider-route-profile.md`
- `wrapper-profile.md`
- `prompt-bundle.md`
- `context-doc.md`
- `context-rule.md`
- `context-skill.md`
- `context-bundle.md`
- `step-policy-profile.md`
- `adapter-capability-profile.md`
- `skill-profile.md`

## Operations
- `live-run-event.md`
- `planner-metrics-snapshot.md`
- `finance-monitoring-snapshot.md`
- `compiler-revision-status.md`
- `learning-loop-scorecard.md`
- `learning-loop-handoff.md`
- `live-e2e-provider-variant.md`
- `live-e2e-scenario-policy.md`
- `live-e2e-target-catalog.md`
- `control-plane-api.md`
- `control-plane-api.openapi.json`

## Loader coverage
See `contract-loader-coverage.md` for the contract-to-loader mapping table, current limitation status, and W0-S03 reference-integrity failure shapes.
