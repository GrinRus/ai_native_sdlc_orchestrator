# Context bundle

## Purpose
Versioned runtime bundle that groups context docs, rules, and skills into one reusable context default for a workflow step.

## Required fields
- `context_bundle_id`
- `version`
- `title`
- `metadata`
- `applies_to`
- `context_doc_refs`
- `context_rule_refs`
- `context_skill_refs`
- `source_refs`
- `selection_policy`

## Notes
Context bundles are selected from `project-profile.default_context_bundles` by workflow step. They do not replace prompt bundles, wrappers, or route profiles.
`W6-S02` declares the reusable bundle shape and project-level defaults only. Actual bundle expansion and runtime assembly begin in `W6-S03`.

A context bundle must reference only AOR-owned runtime context assets. Repository contributor guidance such as `AGENTS.md` or `.agents/**` is out of scope.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source_refs` should point to the committed sources that justify the bundle composition.

## Example
See `examples/context/bundles/*.yaml`.
