# AGENTS.md

API is the public facade for shared control-plane commands, queries,
approvals, task projections, and HTTP/SSE transport.

## Owns

- explicit exports and compatibility at the API package boundary;
- API-facing tests for requests, responses, and event streams.

## Rules

- Keep the API usable without `apps/web`.
- Treat `docs/contracts/control-plane-api.md` as the public source of truth.
- Canonical services and HTTP handlers live in
  `packages/orchestrator-core/src/control-plane/`; follow that owner's guidance
  when changing behavior. Do not duplicate handlers or policy in the facade.
- Preserve explicit exports and the CLI/API boundary; neither app imports the other.
- Use the [validation matrix](../../CONTRIBUTING.md#validation-by-change-type)
  for payload compatibility and affected API tests.
