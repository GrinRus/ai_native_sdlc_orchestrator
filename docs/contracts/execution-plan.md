# Execution plan

## Purpose

Immutable mapping from one approved structured task-plan version to bounded
execution units. Tasks remain stable planning outcomes; units are execution
groupings; attempts are repeated runs of a unit.

## Required fields

- `execution_plan_id`
- `schema_version` (`2` for topology-aware plans)
- `project_id`
- `plan_id`
- `plan_version`
- `plan_ref`
- `plan_digest`
- `status`
- `execution_units`
- `created_at`

Schema version 2 also requires `dag_version`, `dag_digest`,
`source_plan_refs[]`, `impacted_scope`, `non_run_tasks[]`,
`integration_gates[]`, `validation_findings[]`, `concurrency_summary`,
`risks[]`, and `approval`.

## Lifecycle

`status` is `ready`, `blocked`, `superseded`, or `complete`. W60 materializes
units sequentially and may record advisory parallel candidates, but it does not
schedule parallel work. W62 owns bounded concurrency.

Every v2 unit contains `unit_id`, `task_refs[]`, `depends_on[]`, `scope`,
repository/component scope, workspace mounts, conflict keys, command locks,
verification gates, criteria coverage, concurrency classification,
`required_evidence[]`, `integration_requirements[]`, `grouping_rationale`, and
`parallel_candidate`. One task maps to one unit by default. Multiple tasks may
share a unit only when the approved tasks use the same non-empty group key,
provide grouping rationale, and have compatible repository/path scope.

Attempt identity is not stored as mutable plan state. Run evidence cites
`execution_plan_ref` and `execution_unit_id`; task-progress reports project the
resulting attempt refs.

The lifecycle remains deliberately split:

- plan approval controls whether an immutable execution plan may be materialized;
- unit readiness is derived from preserved task dependencies;
- each run reserves a separate attempt identity for one unit;
- retry creates another attempt for the same task and unit references.

## Validation

- Plan identity and digest must cite one approved structured plan.
- Every approved task appears in exactly one unit.
- Unit dependencies preserve task dependencies and remain acyclic.
- Unit scope cannot widen the approved task or handoff scope.
- Grouped units require an explicit rationale.
- Every task maps exactly once to an execution unit or `non_run_tasks[]`.
- `parallel-candidate` means eligible for scheduler consideration, not running.
- Material DAG/scope/content changes produce a new digest and invalidate approval.

## Example

See `examples/packets/execution-plan-structured-medium.yaml`.
