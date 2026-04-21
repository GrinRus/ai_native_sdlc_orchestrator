# Wrapper profile

## Purpose
Execution envelope around a runner session: included files, included packets, tool policy, command policy, output schema hints, verification section, and redaction policy.

## Required fields
- `wrapper_id`
- `version`
- `step_class`
- `prompt_bundle_ref`
- `tool_policy`
- `command_policy`

## Notes
Keep wrapper concerns separate from route selection and prompt-bundle content.

## Example
See `examples/wrappers/*.yaml`.
