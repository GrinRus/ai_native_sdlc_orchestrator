# AGENTS.md

Orchestrator core owns packet lifecycle, workflow decisions, policy execution, and escalation logic.

## Rules
- Write module-facing docs, examples, and comments in English.
- Keep provider-specific behavior out of core.
- Make step transitions explicit and replay-safe.
- Document flow changes in `docs/architecture/**`.
