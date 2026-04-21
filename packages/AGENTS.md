# AGENTS.md

`packages` contains shared runtime modules used by the AOR control plane.

## Rules
- Write module-facing docs, examples, and comments in English.
- Keep boundaries sharp between contracts, orchestration, routing, harness, and observability.
- Avoid leaking provider-specific behavior across package boundaries.
- Read the nearest nested `AGENTS.md` before editing a specific package.
