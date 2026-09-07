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

Selected context bundles enumerate context doc references. The runtime loader
resolves those assets and the compiler records their normalized content, digest,
and provenance. `applies_to` describes intended use; it is not an independent
selection mechanism based on repository facts.

`metadata` should carry durable asset descriptors such as owner, lifecycle channel, and tags. `source` is the authoritative runtime-document payload reference for the asset.

The current compiler includes the context-doc asset YAML inline; it does not
load the linked `source.ref` document into that payload. Follow the
[asset authoring and evidence guidance](../architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes)
when revising content or its version, and inspect the resulting effective asset
payload when making a context-delivery claim.

## Example
See `examples/context/docs/*.yaml`.
