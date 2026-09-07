# AGENTS.md

`examples/prompts` contains canonical runtime prompt bundles selected by project
defaults and step overrides.

## Rules
- Keep guidance task-specific and concise.
- Separate prompt content from wrapper execution policy.
- Keep bundle IDs, execution classes, required inputs, and refs aligned with
  project profiles and the selected wrapper's execution envelope.
- For content-only edits, start at the
  [asset authoring workflow](../../docs/architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes).
  Record the compatibility decision and distinguish contract/reference checks
  from evidence that the revised instructions improve outputs.
