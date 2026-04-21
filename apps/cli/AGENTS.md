# AGENTS.md

CLI is the primary operator surface for bootstrap, runs, delivery, evaluation, harness, and live E2E.

## Owns
- `aor project *`
- `aor run *`
- `aor deliver *`
- `aor eval *`
- `aor harness *`
- `aor live-e2e *`
- `aor ui *`

## Rules
- Write module-facing docs, examples, and comments in English.
- Prefer explicit flags over hidden behavior.
- CLI must remain useful in headless mode.
- Match command semantics in `docs/architecture/14-cli-command-catalog.md`.
