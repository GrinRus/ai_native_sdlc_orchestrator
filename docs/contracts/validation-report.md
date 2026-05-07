# Validation report

## Purpose
Deterministic quality report for schema checks, repo-scope checks, command execution, evidence completeness, and similar objective signals.

## Required fields
- `report_id`
- `subject_ref`
- `validators[]`
- `status`
- `evidence_refs`

## Notes
Validation reports should remain deterministic and machine-readable.
The loader treats `status` and each object-form `validators[].status` as deterministic validation statuses and accepts `pass|warn|fail|blocked`.
Each `validators[]` entry may be a legacy validator id string or an object with `validator_id`, `status`, and `summary`; optional `details` must be an object and optional `evidence_refs[]` must contain strings.
Validators may include full asset-graph findings (reference integrity plus compatibility checks) as long as `validators[]`, `status`, and `evidence_refs[]` remain stable for CI/runtime consumers.
Project validation should include a `repo-scope-proof` validator. For bounded multirepo profiles it reports repo graph consistency, impacted repo scope, per-repo validation refs, integration validation refs, and whether coordination evidence is required before non-`no-write` delivery.
When scoped multirepo work is being prepared, `multirepo-coordination-status` is the dedicated follow-up report for lock acquisition, stale/conflict blockers, and cross-repo validation completeness. Validation reports can point at that report through `evidence_refs[]`; delivery plans should carry its lock and validation refs separately in `coordination`.
