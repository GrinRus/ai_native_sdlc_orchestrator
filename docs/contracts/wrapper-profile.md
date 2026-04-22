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
Wrapper concerns are limited to execution-envelope behavior.

Wrapper profiles do not select prompt bundles and they do not own repository bootstrap files or packet injection. Prompt defaults are project-owned through `project-profile.default_prompt_bundles`, and runtime context defaults are project-owned through `project-profile.default_context_bundles`.

Runtime asset resolution should use `project-profile.default_wrapper_profiles` by route class unless a step-level wrapper override is provided.

## Example
See `examples/wrappers/*.yaml`.
