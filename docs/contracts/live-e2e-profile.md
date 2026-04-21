# Live E2E profile

## Purpose
Reusable rehearsal profile for running AOR against a real target repository.

## Required fields
- `profile_id`
- `version`
- `flow_kind`
- `duration_class`
- `project_profile_template_ref`
- `target_repo`
- `runtime`
- `objective`
- `stages[]`
- `verification`
- `budgets`
- `approvals`
- `output_policy`
- `ui`

## Notes
Profiles may also include a scenario identifier, a task brief, and explicit verification commands. Public-repo defaults should prefer patch or fork-first output and disable upstream write-back.

## Example
See `examples/live-e2e/*.yaml`.
