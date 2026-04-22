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
Prompt bundles should stay lightweight, versioned, and independently certifiable.
Runtime asset resolution should use `project-profile.default_prompt_bundles.<step>` unless a step-level prompt override is provided.

## Example
See `examples/prompts/*.yaml`.
