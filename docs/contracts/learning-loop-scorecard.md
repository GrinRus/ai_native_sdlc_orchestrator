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
- `coverage_follow_up`
- `generated_at`

Producer-generated `scorecard_id` values preserve the readable run-derived form
when it satisfies the public ID grammar. Long canonical run IDs use a stable
content-addressed ID; the complete source identity remains available in
`run_id`.

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

## Loader validation
The shared contract loader validates the nested learning-loop traceability shape:
- evidence and linked-ref arrays must contain strings;
- `matrix_cell` validates known identity, scenario, and provider fields when those fields are present; legacy non-catalog scorecards may keep an empty object;
- `coverage_follow_up.current_cell_required` is validated when present; legacy non-catalog scorecards may keep an empty object;
- next and remaining matrix cells in `coverage_follow_up` must use the same matrix-cell shape.
