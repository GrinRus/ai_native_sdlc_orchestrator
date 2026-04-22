# Adapter capability profile

## Purpose
Capability matrix for a runner adapter such as repo write support, shell access, live logs, structured output, approvals, and sandbox mode.

## Required fields
- `adapter_id`
- `version`
- `capabilities`
- `constraints`

## Notes
Routing should depend on declared capabilities rather than assumptions.
Capability negotiation must happen before adapter invocation; missing required capabilities are deterministic pre-execution failures.
`mock-runner` is the deterministic dry-run baseline profile for rehearsals and tests.

## Example
See `examples/adapters/*.yaml`.
