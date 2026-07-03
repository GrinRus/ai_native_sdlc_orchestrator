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
For medium+ implementation work, the ticket should preserve planning-grade content from the approved intake or spec:
- `goals[]` and `definition_of_done[]` at the top level when supplied by the intake/spec.
- `local_tasks[]` with bounded objectives and task-level acceptance criteria.
- `acceptance_criteria[]` and `expected_evidence[]` that make completeness reviewable before handoff.
- `verification_plan.command_groups[]` when the source mission declares bounded
  setup, baseline, post-change, or diagnostic verification. Legacy
  `verification_expectations.primary_commands[]` may remain for compatibility,
  but command groups are the generic executable contract.
- `scope.allowed_paths[]` narrowed from mission path hints when available; use `**` only when no narrower source-of-truth scope exists.
