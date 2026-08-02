# Self-hosted secrets and redaction

This runbook defines where secrets may live for the bounded self-hosted alpha
mode and which surfaces must redact configured values.

## Secret sources

Keep these outside committed project files:

- detached API bearer token values;
- bearer principal configuration that binds token ids to `read` and/or `mutate`
  scopes;
- runner/provider credentials for external tools;
- local values passed through `AOR_REDACTION_SECRETS`;
- target repository credentials used by Git or provider CLIs.

Do not commit `.env` files, shell transcripts containing tokens, `.aor/`
runtime artifacts with unsanitized payloads, target checkouts, or provider logs.

## Redaction surfaces

Configured secret values must be redacted from:

- HTTP JSON responses;
- SSE event payloads;
- live-run event JSONL logs;
- run-control audit records;
- CLI JSON output when `AOR_REDACTION_SECRETS` is set.

Durable evidence may retain non-secret operator intent, approval refs, policy
decisions, state refs, and evidence refs so blocked or denied actions remain
reviewable.

## Production-hardened API checklist

1. Configure bearer principals outside the repository.
2. Give each principal only the needed scopes: `read`, `mutate`, or both.
3. Scope each principal to the expected `project_id`.
4. Set `AOR_REDACTION_SECRETS` for local values that could appear in command
   output or payloads.
5. Confirm denied requests return stable `auth.*` errors without invoking
   mutation handlers.

The transport hardening behavior is documented in
`docs/ops/control-plane-production-hardening.md` and contract-backed in
`docs/contracts/control-plane-api.md`.
