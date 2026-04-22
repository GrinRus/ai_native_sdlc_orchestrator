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
- `finance_evidence_refs` (finance lineage used by the recertification decision)
- `quality_evidence_refs` (quality lineage used by the recertification decision)
- `finance_evidence_root`
- `quality_evidence_root`
- `platform_recertification` (optional object with platform linkage controls)
- `platform_recertification.linkage_status` (`linked|rollback|unlinked`)
- `platform_recertification.rollback_required` (boolean)
- `platform_recertification.rollout_action` (`promote|hold|reject|freeze|demote`, optional)
- `platform_recertification.promotion_decision_ref` (optional mirror for platform decision linkage)
- `platform_recertification.from_channel` (optional)
- `platform_recertification.to_channel` (optional)
- `reason` (optional)
- `updated_at`

`status` should use this operational set:
- `open`
- `recertify`
- `hold`
- `re-enabled`
- `closed`

Rollback-safe recertification behavior:
- when linked platform rollout action is `freeze` or `demote`, recertification should persist `platform_recertification.rollback_required=true`;
- direct `re-enable` must be converted to `hold` until rollback conditions are resolved.

## Notes
An incident report should be able to backfill a dataset case, trigger recertification, and point to backlog planning surfaces for follow-up slices.
