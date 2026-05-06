# Next action report

## Purpose
Durable report emitted by `aor next`.
It resolves exactly one safe primary action for the current project state while preserving blockers, mission evidence, onboarding evidence, and write-back policy context.

## Required fields
- `report_id`
- `project_id`
- `version`
- `generated_from`
- `project_state`
- `mission_state`
- `primary_action`
- `blockers`
- `bounded_execution`
- `evidence_refs`
- `status`
- `created_at`

## Status
`status` is:
- `ready` when the primary action can be taken without first fixing blockers.
- `blocked` when the primary action is a repair or completion action required before the guided flow can continue.

## Primary action
`primary_action` contains:
- `action_id`
- `command`
- `reason`
- `low_level_command`
- `evidence_refs`

Only one primary action is allowed. Additional suggestions belong in guided UI copy or future reports, not this contract.

## Mission state and bounded execution
`mission_state` links the latest `intake-request` packet and body when present. It must preserve completeness status, missing fields, mission id, delivery mode, allowed paths, and forbidden paths.

`bounded_execution` makes the selected delivery mode explicit before any delivery-capable recommendation. Installed-user guided flows must keep `upstream_writes_default=false`; delivery-capable modes must require review before write-back.
