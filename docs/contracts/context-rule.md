# Context rule

## Purpose
Versioned runtime rule asset that carries always-on operating, security, compliance, or team-standard guidance for one runtime context surface.

## Required fields
- `context_rule_id`
- `version`
- `title`
- `metadata`
- `instruction`
- `source_refs`
- `applies_to`

## Notes
Context rules are AOR-owned runtime assets and should express durable standards that can be pushed into every relevant compiled context.

Context rules are distinct from wrapper policy. Wrappers own execution-envelope behavior; context rules own reusable runtime guidance.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source_refs` should point to the committed sources or governing references that justify the rule text.

## Example
See `examples/context/rules/*.yaml`.
