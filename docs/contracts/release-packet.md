# Release packet

## Purpose
Release-ready summary of a completed wave, linking runs, verification evidence, residual risks, sign-offs, and delivery output.

## Required fields
- `packet_id`
- `project_id`
- `ticket_id`
- `run_refs`
- `change_summary`
- `verification_refs`
- `delivery_manifest_ref`
- `evidence_lineage`
- `status`
- `created_at`

## Notes
The release packet must point to the delivery manifest for the run and preserve lineage back to handoff, promotion, and execution evidence.
Later-maturity release packets should also preserve:
- coordination lineage (`evidence_lineage.coordination_refs`) when cross-repo approval artifacts are required;
- rerun lineage (`evidence_lineage.rerun_refs`) and bounded retry context (`rerun_recovery`).

## Example
See `examples/packets/release-wave-004.yaml`.
