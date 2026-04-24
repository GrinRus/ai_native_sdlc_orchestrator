# Live E2E provider variant

## Purpose
Machine-readable internal catalog document that pins one full-journey live E2E run to one provider and primary adapter path.

## Required fields
- `provider_variant_id`
- `provider`
- `primary_adapter`
- `fallback_policy`
- `route_override_policy`

## Notes
- Provider selection is per-run pinned, not mixed by stage.
- `route_override_policy` should describe how the harness rewrites route profiles for the selected provider variant.
- `fallback_policy` should stay explicit even when fallback is disabled.
- Provider variants may additionally carry `coverage_tier` so the curated matrix can distinguish mandatory coverage (`required`) from extended coverage (`extended`).
