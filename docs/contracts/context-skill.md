# Context skill

## Purpose
Versioned runtime workflow asset that provides reusable step procedures, checklists, or domain-specific operating sequences for relevant steps.

## Required fields
- `context_skill_id`
- `version`
- `title`
- `metadata`
- `objective`
- `workflow`
- `source_refs`
- `applies_to`

## Notes
Context skills are runtime assets for the AOR product. They are separate from repository-development skills under `.agents/skills/**`.

Use context skills for relevance-triggered execution guidance that a future compiler can inject when the step, repo facts, or packet graph matches the declared applicability.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source_refs` should point to the committed sources or operating references that justify the workflow.

## Example
See `examples/context/skills/*.yaml`.
