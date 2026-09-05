# AGENTS.md

`apps` contains user-facing or operator-facing entry points for AOR.

## Rules
- Keep surfaces thin and move orchestration rules into shared packages.
- CLI and API must remain usable without the web UI.
- Read the nearest nested `AGENTS.md` before editing a specific app.
- Use the [validation matrix](../CONTRIBUTING.md#validation-by-change-type) for
  command, API, and rendered browser changes.
