# Step policy profile

## Purpose
Policy definition for one step class: validators, quality gates, retry rules, repair rules, escalation rules, and blocking rules.

## Required fields
- `policy_id`
- `step_class`
- `pre_validators[]`
- `post_validators[]`
- `quality_gate`

## Optional execution-bound fields
- `retry.max_attempts`, `retry.on[]`
- `repair.max_attempts`, `repair.on[]`
- `escalation.*`
- `blocking_rules[]`
- `command_constraints.allowed_commands[]`
- `writeback_policy.mode`

## Notes
Step policies decide how the orchestrator reacts after a step finishes.
Runtime policy resolution merges policy fields with route constraints and project defaults before execution begins.

## Example
See `examples/policies/*.yaml`.
