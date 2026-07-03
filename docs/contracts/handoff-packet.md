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
For medium+ implementation work, the packet should carry the same planning-grade content approved in the wave ticket:
- `goals[]`, `definition_of_done[]`, `local_tasks[]`, `acceptance_criteria[]`, `expected_evidence[]`, and `kpis[]` from the approved intake/spec when present.
- `verification_expectations` copied from the wave ticket so review and operator checks can inspect the mission verification contract directly.
- `verification_plan.command_groups[]` populated with generic AOR command groups for setup, baseline, post-change, and diagnostic checks. Legacy `verification_plan.commands[]` may remain as a compatibility read model for older packets, but new packets should treat command groups as the executable verification contract.
- `allowed_paths[]` narrowed from mission `change_evidence.required_path_prefixes[]` when available; broad `**` scope is acceptable only when the upstream artifact provides no narrower path hints.
Runner prompts and review gates may use these optional fields as completeness evidence, but older handoff packets without them remain loadable.

## Example
See `examples/packets/handoff-wave-004.yaml`.
