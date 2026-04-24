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
