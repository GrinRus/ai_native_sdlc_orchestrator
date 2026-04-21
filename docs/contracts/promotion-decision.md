# Promotion decision

## Purpose
Durable decision record that moves a platform asset or route between draft, candidate, stable, frozen, or demoted states.

## Required fields
- `decision_id`
- `subject_ref`
- `from_channel`
- `to_channel`
- `evidence_refs`
- `status`

## Notes
Promotion decisions should always point to certification evidence and approver context when needed.
