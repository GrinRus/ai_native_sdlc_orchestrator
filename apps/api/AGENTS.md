# AGENTS.md

API is the control-plane surface for commands, queries, approvals, and live event streams.

## Owns
- project and bootstrap commands
- run lifecycle commands
- approval endpoints
- delivery and incident endpoints
- live E2E start/status/report endpoints
- query endpoints and SSE streams

## Rules
- Write module-facing docs, examples, and comments in English.
- Keep the API usable without `apps/web`.
- Treat contracts in `docs/contracts/control-plane-api.md` as the source of truth.
- Put orchestration policy in `packages/orchestrator-core`, not in request handlers.
