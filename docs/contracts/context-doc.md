# Context doc

## Purpose
Versioned runtime documentation asset that supplies reference material for one library, repository area, API surface, or operating domain.

## Required fields
- `context_doc_id`
- `version`
- `title`
- `metadata`
- `source`
- `applies_to`

## Notes
Context docs are AOR-owned runtime assets. They are not repository contributor guidance and they are not selected directly from `AGENTS.md`, `.agents/**`, or ad hoc repo notes.

Use context docs for pull-on-demand knowledge that may be selected by a future compiler based on step, route class, or project-analysis facts.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source` is the authoritative runtime-document payload reference for the asset.

## Example
See `examples/context/docs/*.yaml`.
