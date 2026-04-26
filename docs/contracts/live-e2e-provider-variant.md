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
- `coverage_tier=required` variants must point `primary_adapter` at an adapter capability profile with `execution.live_baseline=true`, `execution.runtime_mode=external-process`, and an executable `execution.external_runtime.command`.
- `coverage_tier=extended` variants may point at candidate adapters that are cataloged but not yet certified as live baselines.
