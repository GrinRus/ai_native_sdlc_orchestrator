# Adapter SDK and Authoring Guide

## Purpose
Define how new runner adapters plug into AOR without leaking provider-specific behavior into orchestrator core.

## Stable SDK surface (W2-S04)
`packages/adapter-sdk/src/index.mjs` provides:
- `createAdapterRequestEnvelope` and `createAdapterResponseEnvelope`;
- deterministic capability negotiation (`resolveAdapterForRoute`, `resolveAdapterMatrix`);
- shared lifecycle hooks (`before_step`, `invoke_adapter`, `after_step`, `on_retry`, `on_repair`, `on_escalation`);
- `createMockAdapter` for deterministic dry-run execution.

## Authoring workflow for a new adapter
1. Add an `adapter-capability-profile` in `examples/adapters/<adapter-id>.yaml`.
2. Declare capabilities conservatively (`repo_write`, `shell_commands`, `live_logs`, and others).
3. Keep provider/model specifics inside adapter code and adapter profile fields only.
4. Run capability negotiation tests to ensure routes fail early when required capabilities are missing.
5. Validate deterministic response normalization (status, summary, evidence refs, tool traces).

## Guardrails
- Do not put orchestration policies in adapter code.
- Do not bypass route-level capability requirements.
- Keep mock adapter behavior deterministic so rehearsals and tests are replay-safe.
