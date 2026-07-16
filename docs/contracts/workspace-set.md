# Workspace set

## Purpose

`workspace-set` is the immutable run-planning identity for the repositories
that a later W62 execution may provision. W61 defines the safety boundary but
does not create worktrees, clones, or run workspaces.

## Required fields

- `workspace_set_id`, `project_id`, `binding_ref`, and `status`
- `repositories[]` with stable `mount_path`, binding/base/commit identity,
  `access_mode`, and explicit `write_scope`
- `conflicts[]` with deterministic blocking evidence

Mount paths are unique portable relative paths. A shared physical repository
may appear more than once only when every use is read-only or when writable
scopes are proven non-overlapping. Ambiguous or equivalent write scopes fail
closed.

See `examples/workspace-sets/aor-core.no-write.yaml`.
