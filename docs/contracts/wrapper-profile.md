# Wrapper profile

## Purpose
Execution envelope around a runner session: tool policy, command policy, output schema hints, verification section, and redaction policy.

## Required fields
- `wrapper_id`
- `version`
- `step_class`
- `tool_policy`
- `command_policy`

## Notes
Keep wrapper concerns separate from route selection and prompt-bundle content.
Runtime asset resolution should use `project-profile.default_wrapper_profiles` by route class unless a step-level wrapper override is provided.

## Example
See `examples/wrappers/*.yaml`.
