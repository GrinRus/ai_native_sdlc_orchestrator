# Incident report

## Purpose
Durable record of a failed release, production issue, or significant workflow failure that should feed learning memory.

## Required fields
- `incident_id`
- `project_id`
- `severity`
- `summary`
- `linked_run_refs`
- `linked_asset_refs`
- `status`

## Optional linkage fields
Use optional fields to preserve traceability from live operations back into quality and planning work:
- `linked_eval_suite_refs`
- `linked_harness_capture_refs`
- `linked_backlog_refs`
- `learning_handoff_ref`
- `evidence_root`
- `created_at`

Recertification and controlled re-enable updates may add:
- `recertification`
- `recertification_updated_at`

`recertification` should preserve transition traceability:
- `decision` (`recertify|hold|re-enable`)
- `from_status`
- `to_status`
- `run_ref`
- `promotion_decision_ref` (optional when no promotion evidence exists yet)
- `promotion_decision_status` (optional)
- `evidence_refs`
- `evidence_root`
- `reason` (optional)
- `updated_at`

`status` should use this operational set:
- `open`
- `recertify`
- `hold`
- `re-enabled`
- `closed`

## Notes
An incident report should be able to backfill a dataset case, trigger recertification, and point to backlog planning surfaces for follow-up slices.
