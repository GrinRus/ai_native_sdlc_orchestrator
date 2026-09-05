# AGENTS.md

CLI is the executable entry point and package facade for the headless operator
surface, including project connection, Task preparation/start, evidence, and
the packaged `aor app` launcher.

## Owns

- executable bootstrap, package facade, and CLI-facing acceptance tests;
- installed-package command availability and process behavior.

## Rules

- Prefer explicit flags over hidden behavior.
- CLI must remain useful in headless mode.
- Match command semantics in `docs/architecture/14-cli-command-catalog.md`.
- Canonical command definitions, handlers, and launcher live in
  `packages/orchestrator-core/src/operator-cli/`; follow that owner's guidance
  when changing behavior. Keep this app thin and independent of `apps/api`.
- Use the [validation matrix](../../CONTRIBUTING.md#validation-by-change-type)
  for command tests and installed-package release evidence when applicable.
