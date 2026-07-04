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

`step_class` identifies the execution class, not necessarily the workflow step
that selected the prompt. Discovery, research, and spec may each resolve a
different prompt bundle through `default_prompt_bundles.discovery`,
`default_prompt_bundles.research`, and `default_prompt_bundles.spec`, while all
three prompt bundles continue to declare `step_class: artifact`.

`artifact-default@v1` remains the compatibility fallback for profiles that still
use one shared artifact prompt across discovery, research, and spec. Step-
specific artifact prompts must validate through this same contract family and
must not require a new loader enum or wrapper class.

## Example
See `examples/prompts/*.yaml`.
