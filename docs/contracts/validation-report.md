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

## Runtime post-validation

The runtime post-validator registry is closed for strict qualification. The
executable IDs are `output-schema`, `evidence-complete`, and
`validation-commands`; unknown or duplicate IDs block provider spawn. A strict
adapter response is accepted only after every declared validator passes. Each
finding carries deterministic `repair_kind` guidance: `output-contract` for
envelope/schema failures, `evidence-reconciliation` for missing, stale, or
contradictory evidence, and `work-product` for target changes that still need
repair. Process and transport failures remain independently classified and may
carry a `not_evaluated` validation status without being rewritten as schema
failures. Legacy non-strict routes remain compatibility-warning and are not
eligible to establish strict qualification.
