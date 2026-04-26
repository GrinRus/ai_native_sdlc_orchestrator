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
Live adapter baselines can add optional execution metadata without changing required fields. `execution` remains optional for dry-run, candidate, and interactive-only adapters. When a live E2E required provider variant points at an adapter, that adapter must be live-runnable and declare:
- `execution.live_baseline: true`
- `execution.runtime_mode: external-process`
- `execution.handler`
- `execution.evidence_namespace`
- `execution.external_runtime.command`
- `execution.external_runtime.args`
- `execution.external_runtime.request_via_stdin`
- `execution.external_runtime.timeout_ms`

`execution.external_runtime.env` is optional and should only carry safe, non-secret runner overrides. Installed-user live E2E runs should inherit host CLI authentication by default instead of encoding auth paths or secrets in adapter profiles.

When live runtime prerequisites are missing (for example command not found on PATH), adapter execution should return explicit blocked semantics instead of synthetic success.
Live E2E preflight must reject required provider variants whose primary adapter lacks the external-live metadata above. Extended provider variants may reference candidate adapters that are not yet live baselines.

## Example
See `examples/adapters/*.yaml`.
