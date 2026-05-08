# Learning-loop handoff

## Purpose
Durable handoff that closes one run into backlog, incident, and follow-up quality work.

## Required fields
- `handoff_id`
- `project_id`
- `run_id`
- `run_status`
- `source_kind`
- `scorecard_ref`
- `incident_ref`
- `backlog_refs`
- `quality_refs`
- `evidence_refs`
- `matrix_cell`
- `coverage_follow_up`
- `generated_at`

## Optional fields
- `summary`
- `next_actions`

## Notes
`incident_ref` may be null when the linked run completed without incident escalation.
`quality_refs` should point to suites or other quality artifacts that guided the follow-up recommendation.
Learning handoff aggregates evidence refs and next actions. It must not replace feature review, Runtime Harness diagnosis, or asset certification decisions, and it must not promote or freeze platform assets directly.

## Loader validation
The shared contract loader validates the nested handoff traceability shape:
- `incident_ref` may be a string or `null`;
- `backlog_refs[]`, `quality_refs[]`, `evidence_refs[]`, and optional `next_actions[]` must contain strings;
- `matrix_cell` validates known identity, scenario, and provider fields when those fields are present; legacy non-catalog handoffs may keep an empty object;
- `coverage_follow_up.current_cell_required` is validated when present; legacy non-catalog handoffs may keep an empty object;
- next and remaining matrix cells in `coverage_follow_up` must use the same matrix-cell shape.
