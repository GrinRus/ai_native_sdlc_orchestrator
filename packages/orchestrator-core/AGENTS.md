# AGENTS.md

Orchestrator core owns packet and Task lifecycle, workflow decisions, policy,
context compilation, runtime state, and escalation.

## Entry points

- `src/operator-cli/` owns canonical command definitions, handlers, and the
  packaged app launcher; `apps/cli` is its thin executable facade.
- `src/control-plane/` owns canonical services, projections, and HTTP/SSE
  transport; `apps/api` is its explicit public facade.
- Start with `docs/architecture/13-package-and-module-map.md` for module
  ownership and `docs/architecture/12-orchestrator-operating-model.md` for
  lifecycle boundaries.

## Rules

- Keep provider-specific behavior out of core.
- Make step transitions explicit and replay-safe.
- Document flow changes in `docs/architecture/**`.
- Preserve shared AOR Home resolution and explicit configuration/export writes.
- Use the [validation matrix](../../CONTRIBUTING.md#validation-by-change-type)
  for the affected runtime, contract, command, or compiler surfaces.
