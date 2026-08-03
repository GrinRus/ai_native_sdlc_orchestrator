# Workspace registry

## Purpose

Own machine-local connected projects, source bindings, storage identity, and
non-secret lifecycle summaries under `~/.aor/workspace/registry.json`.

## Required fields

- `schema_version`, currently `2`
- monotonic `revision`
- nullable `selected_project_id`
- `projects[]`

Each project requires `workspace_project_id` (the collision-safe Workspace
route/storage key), `runtime_project_id` (packet identity), `label`, `source`,
`project_profile_ref`, and `status`. `source.kind` is `local` or `git`. Local
sources carry an absolute canonical `local_path`; Git sources carry a sanitized
`clone_source` and AOR-managed `local_path`.

The registry may store redacted bindings, readiness summaries, and job refs.
It must never store credentials, attachment content, provider environment
values, or runtime evidence bodies.

## Storage identity

`workspace_project_id` uses `<source-slug>-<identity-hash>`. The hash is derived from the
canonical Git identity when available, otherwise the real local path. The same
source reconnects to the same ID; same-name distinct sources cannot collide.

## Mutation

Writes use a revision check, project-scoped validation, sibling temporary file,
and atomic rename. Disconnect removes only the registry association. Deleting
project data is a separate exact-target action and is blocked by active runs.
