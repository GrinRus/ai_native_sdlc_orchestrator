# AGENTS.md

`packages` contains shared runtime modules used by the AOR control plane.

## Rules
- Keep boundaries sharp between contracts, orchestration, routing, harness, and observability.
- Avoid leaking provider-specific behavior across package boundaries.
- Read the nearest nested `AGENTS.md` before editing a specific package.
- Product state resolves through the shared AOR Home helpers; isolate tests with
  `AOR_HOME` and do not introduce per-project runtime-root overrides.
- Use the [validation matrix](../CONTRIBUTING.md#validation-by-change-type)
  for contract, runtime, and runtime-asset changes.
