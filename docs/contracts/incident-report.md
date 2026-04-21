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

## Notes
An incident report should be able to backfill a dataset case, trigger recertification, and point to backlog planning surfaces for follow-up slices.
