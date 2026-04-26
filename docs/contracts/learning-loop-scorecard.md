# Learning-loop scorecard

## Purpose
Durable scorecard that links one completed run to backlog, quality, and incident follow-up surfaces.

## Required fields
- `scorecard_id`
- `project_id`
- `run_id`
- `source_kind`
- `status`
- `summary`
- `evidence_refs`
- `linked_scorecard_refs`
- `linked_eval_suite_refs`
- `linked_harness_capture_refs`
- `linked_backlog_refs`
- `matrix_cell`
- `generated_at`

## Status semantics
`status` should use the normalized run set:
- `pass`
- `fail`
- `aborted`
- `running`
- `unknown`

## Notes
The scorecard is a closure artifact, not a replacement for incident, evaluation, or certification evidence. It should aggregate refs rather than duplicate those payloads.
When a Runtime Harness report exists for the run, the scorecard should link it as evidence rather than duplicating diagnosis payloads.
