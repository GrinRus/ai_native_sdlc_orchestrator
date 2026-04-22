# AGENTS.md

`examples/skills` stores canonical skill-profile examples used by context compilation and reference integrity checks.

## Rules
- Keep skills runner-agnostic and step-class scoped.
- Use versioned `skill_id@vN` references from project profiles.
- Update project profile defaults and override refs when adding or renaming a skill profile.
