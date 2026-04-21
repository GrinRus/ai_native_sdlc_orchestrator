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
- `scope_constraints`
- `command_policy`
- `writeback_mode`
- `approval_state`

## Notes
A handoff packet is the formal approval boundary for implementation work.
`approval_state` must be machine-checkable and distinguish `pending` from `approved`.
`writeback_mode`, `scope_constraints`, and `command_policy` keep downstream execution bounded.

## Example
See `examples/packets/handoff-wave-004.yaml`.
