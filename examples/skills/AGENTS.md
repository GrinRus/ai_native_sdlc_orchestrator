# AGENTS.md

`examples/skills` stores canonical skill-profile examples used by context compilation and reference integrity checks.

These YAML files are runtime assets, not contributor skills from `.agents/skills/`
or context skills selected through bundles under `examples/context/`.

## Rules
- Keep skills runner-agnostic and step-class scoped.
- Use versioned `skill_id@vN` references from project profiles.
- Update project profile defaults and override refs when adding or renaming a skill profile.
- Use the [asset authoring workflow](../../docs/architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes)
  for workflow content, version, compatibility, and evaluation changes.
