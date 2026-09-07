# Task projection

## Purpose

`task-projection` is the versioned, read-only Task Workspace object. It is a
server-owned projection over an intent submission and, after confirmation, its
Mission/Flow/run lineage. The projection is not a second lifecycle store.

## Identity and states

- `schema_version` is `1`.
- `task_id` is stable for the same project and lineage. Intent-backed tasks use
  `task.<project>.<intent>`; Flow-backed tasks use `task.<project>.<flow>`.
- `lineage` preserves `intent_submission_id`, `intent_submission_ref`,
  `normalization_revision`, `mission_id`, `flow_id`, and `run_ids` when known.
- `status` is one of `draft`, `prepared`, `active`, `attention`, or
  `completed`. A completed projection is immutable and must set
  `completed_read_only=true`.
- Older projections may omit additive fields. Consumers must treat a missing
  prepared contract as `unknown`, never infer a route or write permission, and
  must keep the stable identity derived from the existing lineage fields.

## Prepared contract

`prepared_contract` is always present (with explicit unknown/null values for a
legacy or Flow-only projection) and contains:

- `outcome`, `acceptance_criteria[]`, and bounded `scope.allowed_paths[]` /
  `scope.forbidden_paths[]`;
- `delivery_mode` (`no-write`, `patch-only`, `local-branch`, or `fork-first-pr`);
- `normalization_revision`;
- `approved_execution_route` with canonical `route_id`, `step`, `source`, and
  `readiness`, plus `readiness_revision`;
- `write_effects` with `mode`, `write_capable`, `target_write_allowed`,
  `upstream_writes_allowed`, and `direct_edits_allowed`.

`route.intake-normalize.*` is provenance for read-only preparation and is never
an approved execution route. Provider/model strings from normalization are not
execution selection. A prepared Task may expose `primary_action.action_id` only
as the canonical `start`; the displayed `revision` is forwarded as the CAS
guard when starting.

## Compatibility and validation

The projection is additive to the existing Task Workspace API. Unknown status,
route step, readiness, missing execution identity for a prepared Task, or
write-effect contradictions fail contract validation. `read_only` is always
`true`; mutations continue through the intent and Flow control-plane boundaries.

See `examples/tasks/task-projection.prepared.yaml` for a complete positive
fixture and `packages/contracts/test/task-projection-contract.test.mjs` for
negative and migration cases.
