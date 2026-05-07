# Runbook: control-plane production hardening baseline

Use this runbook when a connected operator surface attaches to the detached HTTP/SSE control plane outside local trusted development.

## Modes

- `local-trusted`: default loopback mode for local CLI, tests, and harness workflows. Auth may be disabled, but route permission metadata and redaction helpers still exist.
- `production-hardened`: connected transport mode that requires bearer credentials for reads, streams, and mutations.

## Operator checks

Before starting production-hardened transport:
- configure bearer principals outside committed project files;
- assign only the scopes needed by the caller: `read`, `mutate`, or both;
- scope principals to the expected `project_id` unless cross-project read automation is intentional;
- configure any extra redaction values that should be treated as secrets;
- keep upstream Git/provider permissions separate from AOR transport auth.

## Denied actions

Missing credentials, invalid tokens, wrong-project tokens, and insufficient scopes return `auth.*` errors with:
- `required_permission`;
- `project_id`;
- non-secret `token_id` when a principal was recognized;
- `security_mode`.

Transport-level denials do not invoke mutation handlers. Policy-level denials, such as high-risk run-control commands without required approval, still write audit evidence. The audit record keeps the action, policy context, blocked reason, and requested scope, while configured secret values are replaced with `[REDACTED]`.

## Redaction surfaces

Configured secret values must not appear in:
- HTTP JSON responses;
- SSE event data;
- live-run event JSONL logs;
- run-control audit records;
- CLI JSON output when `AOR_REDACTION_SECRETS` is set.

Durable artifacts may still carry non-secret operator intent, evidence refs, approval refs, and state refs so the denial remains reviewable.
