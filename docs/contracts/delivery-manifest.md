# Delivery manifest

## Purpose
Durable description of how execution became an actual patch, branch, fork PR, or controlled direct write.

## Required fields
- `manifest_id`
- `project_id`
- `ticket_id`
- `run_refs`
- `step_ref`
- `delivery_mode`
- `writeback_policy`
- `repo_deliveries[]`
- `verification_refs`
- `approval_context`
- `evidence_root`
- `source_refs`
- `status`
- `created_at`

## Notes
A delivery manifest is required whenever a flow reaches delivery or release.
Manifest materialization should happen only after a `delivery-plan` artifact is present with `status=ready`.
Delivery-capable runs should include execution isolation metadata (mode, checkout root, and cleanup policy/outcome) so write-back provenance is replayable.

## Example
See `examples/delivery-manifest.sample.yaml`.
