# Wave ticket

## Purpose
Bounded work unit derived from an approved spec. It identifies scope, dependencies, objectives, and expected verification.

## Required fields
- `ticket_id`
- `project_id`
- `objective`
- `scope`
- `dependencies`
- `risk_tier`
- `status`
- `approved_input_ref`

## Notes
A wave ticket is the planning bridge between specification and handoff.
`approved_input_ref` must point to the approved upstream artifact or fixture that authorized ticket creation.
