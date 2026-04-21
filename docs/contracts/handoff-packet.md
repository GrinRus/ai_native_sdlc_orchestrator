# Handoff packet

## Purpose
Approved execution boundary for runner-backed work. It defines allowed repos, paths, commands, verification expectations, approvals, and route overrides.

## Required fields
- `packet_id`
- `project_id`
- `ticket_id`
- `version`
- `status`
- `risk_tier`
- `approved_objective`
- `repo_scopes`
- `allowed_paths`
- `allowed_commands`
- `verification_plan`

## Notes
A handoff packet is the formal approval boundary for implementation work.

## Example
See `examples/packets/handoff-wave-004.yaml`.
