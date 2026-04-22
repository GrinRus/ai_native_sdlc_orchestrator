# Provider route profile

## Purpose
Execution route for a step, including adapter/provider/model choice, required capabilities, fallbacks, and constraints.

## Required fields
- `route_id`
- `step`
- `route_class`
- `risk_tier`
- `primary`

## Notes
Routes choose provider, adapter, model, and execution constraints. They do not own wrapper or prompt selection.

Route resolution should be deterministic: step-level override first, then `project-profile.default_route_profiles`.
If a resolved route points to a different `step`, resolution must fail with an explicit conflict.

## Example
See `examples/routes/*.yaml`.
