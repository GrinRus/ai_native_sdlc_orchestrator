# Task progress report

## Purpose

Evidence-derived projection of structured task, execution-unit, and run-attempt
state for one approved plan version. It is a read artifact, not a manual task
tracker.

## Required fields

- `report_id`
- `project_id`
- `plan_id`
- `plan_version`
- `plan_ref`
- `execution_plan_ref`
- `overall_status`
- `tasks`
- `generated_at`

## Status model

Task status is one of `planned`, `ready`, `blocked`, `in-progress`,
`verification-pending`, `failed`, `stale`, or `complete`. Unit and attempt
status remain separate fields and must not be collapsed into task status.

A task is `complete` only when all mapped criteria are satisfied, required
verification passes, required evidence resolves, no blocking finding remains,
and the task digest still matches the approved plan. Adapter success alone can
advance a task only to `verification-pending`.

Status precedence is deterministic: stale identity, failed attempt or blocking
finding, active attempt, acceptance completeness, then dependency readiness.
Evaluator or adapter summaries cannot override an earlier deterministic state.

Each task projection includes `task_id`, `task_digest`, `status`,
`criteria_status`, `verification_status`, `evidence_status`,
`execution_unit_refs`, `attempt_refs`, `evidence_refs`, `blocking_findings`,
and `next_action`.

## Example

See `examples/reports/task-progress-report-structured-medium.yaml`.
