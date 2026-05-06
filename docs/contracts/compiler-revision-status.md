# Compiler revision status

## Purpose
Durable status report for one compiler revision as a first-class platform asset.

Compiler revisions describe the runtime context/compiler implementation that produced compiled-context artifacts. They are separate from individual compiled-context outputs: a compiled context records one step-specific output, while a compiler revision records the platform asset lifecycle, compatibility evidence, promotion/freeze decisions, incident linkage, and evaluation lineage for the compiler that produced those outputs.

## Required fields
- `status_id`
- `project_id`
- `compiler_revision_ref`
- `compiler_revision`
- `lifecycle_state`
- `compatibility`
- `decision_history`
- `evidence_links`
- `status`
- `blocking_reasons`
- `created_at`

## Lifecycle states
`lifecycle_state` must be one of:
- `draft`
- `candidate`
- `stable`
- `frozen`
- `demoted`
- `blocked`

## Status values
`status` must be one of:
- `ready`
- `blocked`

## Notes
State-changing actions (`promote`, `freeze`, `demote`) require durable promotion-decision evidence. `inspect` may produce a read-only status snapshot without changing the compiler revision state.

`compiler_revision` should include:
- `revision_id`;
- `version` when the ref encodes one;
- `source_ref`;
- `compiler_family`;
- `provenance_refs`.

`compatibility` should include:
- `status` (`compatible|incompatible|unknown`);
- `compiled_context_refs`;
- `evaluation_refs`;
- `incident_refs`;
- `certification_evidence_refs`.

`decision_history[]` should include promotion/freeze/demote decisions and prior compiler-revision status reports that mention the same revision. Each entry should carry the decision/status id, ref/file, lifecycle state, status, and creation time.

`evidence_links` keeps compiler revision evidence queryable from CLI/API surfaces:
- `promotion_decision_refs`;
- `compiled_context_refs`;
- `evaluation_refs`;
- `incident_refs`;
- `certification_evidence_refs`.

## Example
See `examples/reports/compiler-revision-status.sample.yaml`.
