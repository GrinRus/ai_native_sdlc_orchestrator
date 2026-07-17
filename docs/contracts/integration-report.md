# Integration report

## Purpose

Versioned, parent-run-owned evidence for combining immutable child outputs in
an isolated integration workspace. The report is the source of truth for apply
order, aggregate quality gates, precise stale invalidation, retained recovery
state, and delivery readiness.

## Required fields

- `schema_version` (`1`)
- `report_id`, `project_id`, `parent_run_id`, `revision`
- `execution_plan_ref`, `workspace_set_ref`
- `status`
- `source_attempts[]`, `repository_results[]`, `aggregate_gates[]`
- `stale_units[]`, `repair_refs[]`, `blockers[]`, `evidence_refs[]`
- `created_at`, `updated_at`

Only patch or commit outputs owned by the same project and parent run are
accepted. Apply order follows the approved execution DAG. Repository results
must point at disposable integration roots and never at primary checkouts.

Aggregate gates record verification, review, QA, and Runtime Harness results.
A parent run cannot pass or become deliverable until every required gate
passes. Stale units record changed input fingerprints and the transitive rerun
boundary while historical attempts remain immutable.

Integration findings reuse `quality-repair-request`. Its existing
`source_stage=review|qa` remains authoritative. Optional `origin_context`
identifies the parent run, execution unit or integration gate, and input
fingerprint that produced the finding.

## Example

See `examples/reports/integration-report-parent-run.yaml`.
