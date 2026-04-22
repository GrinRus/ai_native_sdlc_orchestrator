# Prompt bundle

## Purpose
First-class guidance asset for a step class. It defines role instructions, priorities, required inputs, output expectations, stop conditions, and certification hints.

## Required fields
- `prompt_bundle_id`
- `version`
- `step_class`
- `objective`
- `instructions`
- `required_inputs`

## Notes
Prompt bundles stay lightweight, versioned, and independently certifiable.

Prompt selection is project-owned and resolves through `project-profile.default_prompt_bundles`, not through wrapper profiles.

Prompt bundles may declare required packet or artifact inputs, but they do not own repository guidance selection, file bootstrap, or runtime context expansion. Those concerns belong to project-profile defaults and the future context compiler.

## Example
See `examples/prompts/*.yaml`.
