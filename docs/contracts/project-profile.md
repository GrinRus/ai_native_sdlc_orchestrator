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
- `default_skill_profiles`
- `skill_overrides`
- `budget_policy`
- `approval_policy`
- `security_policy`
- `runtime_defaults`
- `writeback_policy`

## Notes
Use the project profile as the durable source of truth for execution defaults. Live E2E profiles may override specific target-repo details without replacing the full project profile.

`default_skill_profiles` maps route classes (`artifact`, `planner`, `runner`, `repair`, `eval`, `harness`) to ordered skill refs (`skill_id@vN`).
`skill_overrides` maps route step slots (`discovery`, `research`, `spec`, `planning`, `implement`, `review`, `qa`, `repair`, `eval`, `harness`) to ordered skill refs and has higher precedence than defaults.

`runtime_defaults.workspace_mode` controls execution isolation:
- `ephemeral` — run inside the primary checkout;
- `workspace-clone` — run in an isolated filesystem clone;
- `worktree` — run in an isolated worktree-style root.

Optional `runtime_defaults.workspace_cleanup` can define `on_success`, `on_abort`, and `on_failure` actions (`delete`, `retain`, or `none`) for isolated roots.

`writeback_policy.default_delivery_mode` should resolve to one of the delivery-plan modes:
- `no-write`
- `patch-only`
- `local-branch`
- `fork-first-pr`

Legacy aliases (`patch`, `pull-request`) may still appear in older fixtures, but runtime planning normalizes them to canonical delivery-plan modes before write-back policy checks.

## Example
See `examples/project.aor.yaml and examples/project.github.aor.yaml`.
