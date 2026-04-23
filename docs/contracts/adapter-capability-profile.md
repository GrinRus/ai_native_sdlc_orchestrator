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
Live adapter baselines can add optional execution metadata without changing required fields. The current external-live baseline supports:
- `execution.runtime_mode: external-process`
- `execution.handler`
- `execution.evidence_namespace`
- `execution.external_runtime.command`
- `execution.external_runtime.args`
- `execution.external_runtime.request_via_stdin`
- `execution.external_runtime.timeout_ms`
- `execution.external_runtime.env`

When live runtime prerequisites are missing (for example command not found on PATH), adapter execution should return explicit blocked semantics instead of synthetic success.

## Example
See `examples/adapters/*.yaml`.
