# Step policy profile

## Purpose
Policy definition for one step class: validators, quality gates, retry rules, repair rules, escalation rules, and blocking rules.

## Required fields
- `policy_id`
- `step_class`
- `pre_validators[]`
- `post_validators[]`
- `quality_gate`

## Notes
Step policies decide how the orchestrator reacts after a step finishes.

## Example
See `examples/policies/*.yaml`.
