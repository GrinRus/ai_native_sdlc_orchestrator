# Project profile

## Purpose
Persistent configuration for one target project, including repos, allowed providers/adapters, default routes, wrappers, policies, budgets, security rules, runtime defaults, and live-E2E defaults.

## Required fields
- `project_id`
- `display_name`
- `repo_topology`
- `repos[]`
- `allowed_providers[]`
- `allowed_adapters[]`
- `default_route_profiles`
- `default_step_policies`
- `default_wrapper_profiles`
- `budget_policy`
- `approval_policy`
- `security_policy`
- `runtime_defaults`
- `writeback_policy`

## Notes
Use the project profile as the durable source of truth for execution defaults. Live E2E profiles may override specific target-repo details without replacing the full project profile.

`runtime_defaults.workspace_mode` controls execution isolation:
- `ephemeral` — run inside the primary checkout;
- `workspace-clone` — run in an isolated filesystem clone;
- `worktree` — run in an isolated worktree-style root.

Optional `runtime_defaults.workspace_cleanup` can define `on_success`, `on_abort`, and `on_failure` actions (`delete`, `retain`, or `none`) for isolated roots.

## Example
See `examples/project.aor.yaml and examples/project.github.aor.yaml`.
