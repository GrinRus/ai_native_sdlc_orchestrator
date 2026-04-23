# Compiled context artifact

## Purpose
Runtime artifact that captures the selected prompt bundle, resolved context bundles, expanded docs/rules/skills, packet refs, hashes, and provenance for one step.

## Required fields
- `compiled_context_id`
- `version`
- `step`
- `prompt_bundle_ref`
- `context_bundle_refs`
- `context_doc_refs`
- `context_rule_refs`
- `context_skill_refs`
- `packet_refs`
- `hashes`
- `provenance`

## Notes
This contract family is introduced in `W6-S02` so downstream runtime, harness, and promotion contracts can refer to one stable compiled-context shape before the compiler exists.

`W6-S02` includes only static sample artifacts. Runtime generation, persistence, and adapter-context injection start in `W8-S08`.

Runtime outputs are run/step scoped: `compiled_context_id` and the persisted report filename include run identity, step identity, and execution attempt so repeated same-step executions in one runtime root do not overwrite prior artifacts.

## Example
See `examples/context/compiled/*.yaml`.
