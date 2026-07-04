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
- `skill_refs`
- `packet_refs`
- `hashes`
- `provenance`
- `budget_report`
- `compaction_report`

## Notes
This contract family is introduced in `W6-S02` so downstream runtime, harness, and promotion contracts can refer to one stable compiled-context shape before the compiler exists.

`W6-S02` includes only static sample artifacts. Runtime generation, persistence, and adapter-context injection start in `W8-S08`.

Runtime outputs are run/step scoped: `compiled_context_id` and the persisted report filename include run identity, step identity, and execution attempt so repeated same-step executions in one runtime root do not overwrite prior artifacts.

Compiled context is the prepare-phase artifact for routed adapter-backed steps. Runtime execution must be able to trace adapter invocation back to the prompt bundle, context docs, context rules, context skills, workflow skill profiles, wrapper, policy, packet refs, guardrails, and provenance used to build the request.

`budget_report` records deterministic size estimates before a provider is invoked:
- `bytes`
- `chars`
- `estimated_tokens`
- `budget_limit_tokens`
- `budget_status` in `pass|warn|fail|not_configured`
- `source_breakdown[]` with `source`, `bytes`, `chars`, and `estimated_tokens`

The estimate is intentionally conservative and provider-agnostic. It is used for fail-fast context-budget checks and for explaining which context groups made a provider request too large.

`compaction_report` records how the runtime converted the full internal compiled context into a bounded provider work packet:
- `strategy` such as `none` or `deterministic-ref-summary`
- `original_estimate`
- `final_estimate`
- `dropped_or_summarized_sources[]`
- `mandatory_refs_preserved[]`

The full request envelope may remain available as AOR evidence, but the provider-facing work packet should prefer stable refs and short summaries over embedding large route, policy, evidence, transcript, fixture, or historical payloads.

Packet refs may be abstract (`packet://handoff`) or concrete (`packet://handoff@evidence://...`). Concrete refs bind the required packet name to a materialized run artifact and should be preferred in adapter requests when the artifact is available, so non-interactive runners can open the intended handoff/spec evidence without broad repository discovery.

`provenance` may include `compiler_revision_ref` when the compiled context was produced by a tracked compiler revision. New artifacts should use `compiler-revision://<revision_id>@vN`; existing `compiler://<revision_id>@vN` refs remain readable and normalize into the compiler revision lifecycle surfaces.

When compiler revision lifecycle evidence exists, `compiler-revision-status` links the revision back to compiled-context refs, certification evidence, evaluation refs, incident refs, and decision history. The compiled-context artifact remains step-scoped; the compiler revision status is the platform-asset lifecycle record.

## Example
See `examples/context/compiled/*.yaml`.
