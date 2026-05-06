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
Validators may include full asset-graph findings (reference integrity plus compatibility checks) as long as `validators[]`, `status`, and `evidence_refs[]` remain stable for CI/runtime consumers.
Project validation should include a `repo-scope-proof` validator. For bounded multirepo profiles it reports repo graph consistency, impacted repo scope, per-repo validation refs, integration validation refs, and whether coordination evidence is required before non-`no-write` delivery.
