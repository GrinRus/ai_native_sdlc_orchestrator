# Onboarding report

## Purpose
Durable report emitted by `aor project init` and `aor onboard` to explain clean-project readiness, asset mode, registry-root resolution, blockers, next action, and write effects.

## Required fields
- `report_id`
- `project_id`
- `version`
- `generated_from`
- `project_state`
- `asset_mode`
- `registry_roots`
- `readiness`
- `blockers[]`
- `next_action`
- `write_effects`
- `status`

## Notes
`asset_mode` is closed to:
- `bundled` — AOR resolves platform asset registries from the installed/bundled AOR assets without copying `examples/` into the target repository.
- `materialized` — AOR writes or reuses committed target-repo assets, such as `project.aor.yaml` and `examples/**`, only after explicit materialization/ejection intent.

`registry_roots` records the resolved roots used by route, wrapper, prompt, policy, adapter, evaluation, and context loading paths. Paths may be absolute when they point to bundled installed assets; materialized roots should usually be target-repo relative in the project profile and resolved in the report.

`write_effects` must distinguish target repository writes from runtime-root writes. Bundled onboarding is allowed to write runtime state under `.aor/`, but must report zero target-repo asset writes and no copied example registries.

The report is published only as part of a validated per-project runtime
transaction. Its runtime references describe the final canonical layout, never
the sibling staging directory. Materialized profiles and registry assets are
created through staged sibling files with rollback tracking and cannot overwrite
pre-existing project files. The legacy top-level `context/` copy is not emitted;
context registry roots resolve from the declared `examples/context/**` tree.

`status` is `ready` when onboarding produced a usable project profile, runtime layout, registry roots, and bootstrap packet. It is `blocked` when the report is emitted for a detected state that cannot safely continue; blockers must identify the missing or invalid precondition and a deterministic next command.

## Example
See `examples/reports/onboarding-report.bundled.yaml`.
