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

## Example
See `examples/skills/*.yaml`.
