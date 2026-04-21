# Project profile

## Purpose
Persistent configuration for one target project, including repos, allowed providers/adapters, committed runtime asset roots, default routes, wrappers, prompt bundles, context bundles, policies, budgets, security rules, runtime defaults, and live-E2E defaults.

## Required fields
- `project_id`
- `display_name`
- `repo_topology`
- `repos[]`
- `allowed_providers[]`
- `allowed_adapters[]`
- `registry_roots`
- `default_route_profiles`
- `default_step_policies`
- `default_wrapper_profiles`
- `default_prompt_bundles`
- `default_context_bundles`
- `default_skill_profiles`
- `skill_overrides`
- `budget_policy`
- `approval_policy`
- `security_policy`
- `runtime_defaults`
- `writeback_policy`

## Notes
Use the project profile as the durable source of truth for runtime default selection.

Deterministic runtime default resolution follows this order:
1. route from `default_route_profiles.<step>`;
2. wrapper from `default_wrapper_profiles.<route_class>`;
3. prompt bundle from `default_prompt_bundles.<step>`;
4. context bundles from `default_context_bundles.<step>[]`.

`registry_roots` declares the committed AOR asset roots for routes, wrappers, prompt bundles, and runtime context assets. Runtime context assets are AOR-owned committed artifacts, not contributor guidance files from the target repository.
Committed registry roots are source assets and static samples only. Runtime-generated outputs still belong under `.aor/`.

`default_prompt_bundles` is keyed by workflow step and resolves one prompt bundle ref per step.
`default_context_bundles` is keyed by workflow step and resolves one or more context bundle refs per step.
These fields declare deterministic defaults only. Actual context selection, expansion, and prompt/context assembly begin in `W6-S03`.

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

`runtime_defaults.workspace_mode` controls execution isolation:
- `ephemeral` — run inside the primary checkout;
- `workspace-clone` — run in an isolated filesystem clone;
- `worktree` — run in an isolated worktree-style root.

Optional `runtime_defaults.workspace_cleanup` can define `on_success`, `on_abort`, and `on_failure` actions (`delete`, `retain`, or `none`) for isolated roots.

## Example
See `examples/project.aor.yaml` and `examples/project.github.aor.yaml`.
