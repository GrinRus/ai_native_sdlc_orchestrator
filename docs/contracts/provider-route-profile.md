# Provider route profile

## Purpose
Execution route for a step, including adapter/provider/model choice, required capabilities, fallbacks, wrapper reference, and constraints.

## Required fields
- `route_id`
- `step`
- `route_class`
- `risk_tier`
- `primary`
- `wrapper_profile_ref`

## Notes
Routes should also declare fallback behavior, required adapter capabilities, and promotion channel.

## Example
See `examples/routes/*.yaml`.
