# Review decision

## Purpose
Durable approval decision for one reviewed run.

`review-report` remains the report-only quality verdict. `review-decision` records an explicit operator decision that downstream delivery and release gates can inspect without reinterpreting narrative review fields.

## Required fields
- `decision_id`
- `project_id`
- `run_id`
- `decision`
- `decider_ref`
- `reason`
- `review_report_ref`
- `runtime_harness_report_ref`
- `delivery_manifest_refs`
- `learning_handoff_refs`
- `decision_basis`
- `delivery_gate`
- `evidence_refs`
- `decided_at`

## Decision vocabulary
`decision` must use:
- `approve`
- `hold`
- `request-repair`

`approve` is only valid when the linked `review-report.overall_status` is `pass` and the linked `runtime-harness-report.overall_decision` is `pass`.

`hold` preserves a human stop without claiming repair has started.

`request-repair` records that downstream work should repair the linked run before delivery/release approval.

## Decision basis
`decision_basis` should preserve:
- `review_overall_status`
- `review_recommendation`
- `runtime_harness_overall_decision`
- `blocking_findings`

## Delivery gate
`delivery_gate` should preserve:
- `status` (`pass|blocked`)
- `blocks_downstream`
- `required_downstream_decision`
- `findings`

Delivery and release commands that opt into the review-decision gate must require the latest run-linked `review-decision` to be `approve`; `hold` and `request-repair` must block.

## Boundary rules
- `review-decision` must not replace deterministic validation, evaluation, Runtime Harness diagnosis, or delivery manifests.
- The artifact may reference delivery manifests and learning-loop handoffs when they already exist, but it must be valid before delivery artifacts exist.
- The artifact is append-only decision evidence; later decisions create a new artifact rather than mutating prior approvals.
