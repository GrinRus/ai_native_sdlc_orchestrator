# AGENTS.md

CLI is the primary operator surface for bootstrap, runs, delivery, evaluation, harness, incidents, and UI lifecycle.

## Owns
- `aor project *`
- `aor run *`
- `aor deliver *`
- `aor eval *`
- `aor harness *`
- `aor ui *`

## Rules
- Write module-facing docs, examples, and comments in English.
- Prefer explicit flags over hidden behavior.
- CLI must remain useful in headless mode.
- Match command semantics in `docs/architecture/14-cli-command-catalog.md`.
