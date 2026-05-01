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

`execution.external_runtime.permission_policy` is optional for backwards compatibility. When present, it declares named non-interactive permission modes:
- `default_mode` selects the adapter default when `AOR_RUNTIME_AGENT_PERMISSION_MODE` is not set.
- `modes.<mode>.args` replaces `execution.external_runtime.args` for that selected mode.

Live E2E defaults to `full-bypass` so installed-user acceptance runs do not hang on runtime-agent approval prompts inside isolated target checkouts. `restricted` should preserve the safer adapter-native prompting mode for local diagnostics. If `AOR_RUNTIME_AGENT_PERMISSION_MODE` requests a mode that the profile does not declare, adapter execution must return blocked semantics with `failure_kind=permission-policy-invalid`. Profiles without `permission_policy` keep using legacy `execution.external_runtime.args`.
In-process adapters without `execution.external_runtime`, such as `mock-runner`, may declare profile-level `permission_policy: not_applicable` as informational evidence that runtime-agent approval prompts do not apply.

When live runtime prerequisites are missing (for example command not found on PATH), adapter execution should return explicit blocked semantics instead of synthetic success.
Live E2E preflight must reject required provider variants whose primary adapter lacks the external-live metadata above. Extended provider variants may reference candidate adapters that are not yet live baselines.

## Example
See `examples/adapters/*.yaml`.
