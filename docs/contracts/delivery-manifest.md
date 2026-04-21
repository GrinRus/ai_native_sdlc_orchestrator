# Delivery manifest

## Purpose
Durable description of how execution became an actual patch, branch, fork PR, or controlled direct write.

## Required fields
- `manifest_id`
- `project_id`
- `ticket_id`
- `run_refs`
- `delivery_mode`
- `writeback_policy`
- `repo_deliveries[]`
- `verification_refs`
- `status`

## Notes
A delivery manifest is required whenever a flow reaches delivery or release.

## Example
See `examples/delivery-manifest.sample.yaml`.
