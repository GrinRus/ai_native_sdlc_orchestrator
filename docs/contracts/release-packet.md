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
- `status`

## Notes
The release packet should point to the delivery manifest when delivery happened.

## Example
See `examples/packets/release-wave-004.yaml`.
