# Live E2E profile

## Purpose
Reusable rehearsal profile for running AOR against a real target repository.

## Required fields
- `profile_id`
- `version`
- `flow_kind`
- `duration_class`
- `project_profile_template_ref`
- `target_repo`
- `preflight`
- `runtime`
- `objective`
- `stages[]`
- `verification`
- `budgets`
- `approvals`
- `output_policy`
- `ui`

## Notes
Profiles should encode no-write preflight behavior as machine-readable data under `preflight`:
- `mode` — should default to `no-write` for public targets;
- `sequence` — expected bootstrap path (`clone`, `inspect`, `analyze`, `validate`, `verify`, `stop`);
- `prerequisites` — minimum environment/tooling requirements before run start;
- `repo_shape_notes` — target topology or workflow expectations;
- `failure_safe_defaults` — safe defaults that remain true even on partial failure;
- `abort_conditions` — explicit stop conditions that terminate a rehearsal early;
- `reusable_assumptions` — assumptions that later bootstrap, quality, and delivery rehearsals can reuse.

Profiles may also include a scenario identifier, a task brief, and explicit verification commands. Public-repo defaults should prefer patch or fork-first output and disable upstream write-back.

Profiles may optionally include a `learning_loop` object to shape closure linkage behavior:
- `learning_loop.force_incident` — force incident artifact materialization even when run status is `pass`;
- `learning_loop.backlog_refs[]` — override default backlog/runbook refs embedded in generated learning-loop handoff artifacts.

## Example
See `examples/live-e2e/*.yaml`.
