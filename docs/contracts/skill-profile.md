# Skill profile

## Purpose
Versioned skill asset used by context compilation to inject step-class-specific workflow guidance into adapter context.

## Required fields
- `skill_id`
- `version`
- `step_class`
- `summary`
- `workflow[]`

## Notes
Skill profiles are runner-agnostic and deterministic.
For this initiative, skill source-of-truth is AOR contracts/examples (`AOR as Source`). External imports may exist later, but compiled execution context must resolve to versioned AOR skill refs.
`step_class` must be one of:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`

Skill references use `skill_id@vN` format and are selected through `project-profile.default_skill_profiles` with optional `project-profile.skill_overrides` by step.

These YAML profiles are runtime assets, distinct from contributor skills under
`.agents/skills/` and from context skills selected through context bundles.
Selection uses the explicit project defaults and overrides; `activation_hints`
does not independently choose a workflow. The compiler includes selected
workflow content and records content identity as well as the versioned ref.

Use the [asset authoring and evidence guidance](../architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes)
for content revisions, compatibility decisions, and evaluation. Keep workflow
instructions within the selected step's execution contract; an instruction does
not grant permissions beyond its wrapper and policy.

## Example
See `examples/skills/*.yaml`.
