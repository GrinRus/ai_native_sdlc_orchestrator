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

Selected context bundles enumerate context skill references. The runtime loader
resolves those assets and the compiler includes their normalized workflow
content, digest, and provenance. `applies_to` describes intended use; it does
not independently activate a skill from repository facts or the packet graph.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source_refs` should point to the committed sources or operating references that justify the workflow.

For content, version, compatibility, and evaluation decisions, use the
[asset authoring and evidence guidance](../architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes).
Changing the workflow under the same version changes its content identity;
prior evidence must not be treated as proof of the revised instructions.

## Example
See `examples/context/skills/*.yaml`.
