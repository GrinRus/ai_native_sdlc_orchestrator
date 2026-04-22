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
Runtime asset resolution should use wrapper `prompt_bundle_ref` unless a step-level prompt override is provided.
Context compilation consumes prompt bundle `instructions`, `required_inputs`, and output hints to produce `compiled_context.instruction_set` and `compiled_context.required_inputs_resolved`.

## Example
See `examples/prompts/*.yaml`.
