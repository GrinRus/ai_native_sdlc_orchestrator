# Project profile

## Purpose
Persistent configuration for one target project, including repos, allowed providers/adapters, committed runtime asset roots, default routes, wrappers, prompt bundles, context bundles, policies, budgets, security rules, and runtime defaults.

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

`asset_mode` is optional for backward compatibility and should be present on new or materialized profiles:
- `bundled` resolves AOR-provided registry roots from the installed AOR asset bundle without copying example registries into the target repository;
- `materialized` resolves registry roots from target-repo committed assets after the user explicitly materializes or ejects them.

For bounded multirepo flows, one project profile owns all participating `repos[]` entries and any `repo_graph` dependency edges. This supports separate backend, mobile, frontend, documentation, or shared-library repositories inside one AOR flow; it is not the same as coordinating multiple independent AOR `project_id` profiles.

Bounded multirepo profiles should keep each repo entry explicit:
- `repo_id`, `role`, `default_branch`, and `source.kind`;
- a stable checkout or workspace-local `source.root` when delivery evidence must classify changed paths by repo;
- per-repo build, lint, and test command candidates when they are known.

`repo_graph[]` edges should identify `from_repo_id`, `to_repo_id`, and `relationship`. Edges may carry `validation_refs[]` for integration checks such as backend-to-frontend API compatibility or backend-to-mobile contract compatibility. These refs become deterministic integration validation evidence in project analysis and validation reports.

Deterministic runtime default resolution follows this order:
1. route from `default_route_profiles.<step>`;
2. wrapper from `default_wrapper_profiles.<route_class>`;
3. prompt bundle from `default_prompt_bundles.<step>`;
4. context bundles from `default_context_bundles.<step>[]`.

`registry_roots` declares AOR asset roots for routes, wrappers, prompt bundles, policies, adapters, evaluation registries, skill profiles, and runtime context assets. Runtime context assets are AOR-owned artifacts, not contributor guidance files from the target repository. Relative roots resolve from the target project root; absolute roots are allowed for bundled installed assets. Runtime-generated outputs still belong under `.aor/`.

The canonical registry-root keys are:
- `routes`
- `wrappers`
- `prompts`
- `policies`
- `adapters`
- `evaluation`
- `skills`
- `context_docs`
- `context_rules`
- `context_skills`
- `context_bundles`

W21 guided onboarding preserves both modes:
- bundled mode is the default clean-repo path and must not copy `examples/` into the target repository;
- materialized mode is explicit and records intentional asset ejection/materialization when a user wants local committed AOR assets;
- runtime outputs still belong under `.aor/` in both modes.

`default_prompt_bundles` is keyed by workflow step and resolves one prompt bundle ref per step.
`default_context_bundles` is keyed by workflow step and resolves one or more context bundle refs per step.
These fields declare deterministic defaults only. Actual context selection, expansion, and prompt/context assembly begin in `W8-S08`.

Workflow-step keys and execution classes are intentionally separate. The
`discovery`, `research`, and `spec` prompt defaults may point at distinct prompt
bundle refs, but those prompt bundles remain compatible with
`step_class: artifact`, `default_wrapper_profiles.artifact`,
`default_step_policies.artifact`, and `default_skill_profiles.artifact`.
Bundled examples select `prompt-bundle://discovery-default@v1`,
`prompt-bundle://research-default@v1`, and `prompt-bundle://spec-default@v1`.
Profiles that still point all three keys at `prompt-bundle://artifact-default@v1`
remain valid.

`artifact_readiness_policy` is optional. When omitted, `aor next` uses strict
artifact readiness: research must be `adr-ready` before spec can become ready,
and stale discovery/research/spec evidence blocks downstream planning. A profile
may set
`artifact_readiness_policy.research.allow_incomplete_for_spec: true` with a
human-readable `reason` to allow bounded spec drafting from incomplete research.
That soft decision must remain visible in `next-action-report.artifact_readiness`
and does not make stale evidence current.

`quality_repair_policy` is optional. When omitted, W45 repair-cycle behavior
must resolve its attempt limits and downstream gate behavior from the selected
runtime policy rather than hardcoding a default in reports. New profiles may
declare:
- `policy_ref`, a stable profile-local policy reference;
- `max_attempts_per_cycle`, copied into
  `quality-repair-request.attempt_budget.max_attempts`;
- `requires_review_after_repair`, which should be `true` for public repair
  loops;
- `requires_qa_after_passing_review`, which applies when QA is in scope;
- `budget_exhausted_requires_operator_approval`, which blocks delivery/release
  until explicit approval exists;
- `blocks_delivery_while_open`, which blocks delivery/release while a required
  request is not `closed`;
- `qa_in_scope_stages[]`, the stages whose repair closure must return through
  QA after a passing review.

`default_skill_profiles` maps route classes (`artifact`, `planner`, `runner`, `repair`, `eval`, `harness`) to ordered skill refs (`skill_id@vN`).
`skill_overrides` maps route step slots (`discovery`, `research`, `spec`, `planning`, `implement`, `review`, `qa`, `repair`, `eval`, `harness`) to ordered skill refs and has higher precedence than defaults.

`runtime_defaults.workspace_mode` controls execution isolation:
- `ephemeral` — run inside the primary checkout;
- `workspace-clone` — run in an isolated filesystem clone;
- `worktree` — run in an isolated worktree-style root.

Optional `runtime_defaults.workspace_cleanup` can define `on_success`, `on_abort`, and `on_failure` actions (`delete`, `retain`, or `none`) for isolated roots.

`verification.command_groups[]` is the generic AOR verification contract for
target projects. Each group must carry:
- `id`
- `role`: `setup`, `build`, `lint`, `test`, `typecheck`, `e2e`, `full-suite`, or `custom`
- `phase`: `readiness`, `baseline`, `post-change`, or `diagnostic`
- `enforcement`: `required`, `warn`, or `observe`
- `timeout_class`: `install`, `build`, `focused-test`, `full-suite`, `browser-e2e`, or `quick`
- `commands[]`

Groups may also carry authoring metadata used by W54 discovery and profile
generation:
- `repo_id` to bind the group to one `repos[].repo_id`;
- `working_dir` as the repo-relative execution directory;
- `depends_on[]` with prerequisite command-group ids;
- `detected_from[]` with manifest, script, or operator source refs;
- `package_manager` for the detected ecosystem driver;
- `tool_requirements[]` entries with `tool`, optional `version_range`, and
  optional `install_hint`;
- `skip_policy` with optional `outcome`, `applies_when`, and `reason`.

Generic command-group outcomes are `no-tests`, `missing-tool`,
`not-applicable`, and `broken-baseline`. They are AOR verification evidence and
must not use private proof-harness fields such as target-matrix, run-health, or
step-quality metadata.

`project init` materializes discovery-backed command groups for detected stacks
and may record `verification.discovery_outcomes[]` and
`verification.discovery_suggestions[]` when no runnable verification command is
detected. These records are evidence for operator review, not invented passing
commands.

Legacy per-repo `build_commands`, `lint_commands`, and `test_commands` remain
loadable and are normalized into required command groups by `project verify`
when `verification.command_groups[]` is absent.

For migration guidance, see
`docs/ops/verification-command-groups-migration.md`. New profiles should author
command groups directly, keep legacy command lists only as compatibility read
models, and treat `warn` and `observe` groups as non-acceptance evidence.

`project verify` target commands are bounded per command.
`runtime_defaults.verification_command_timeout_sec` may set an explicit
per-command timeout for every command group. If it is omitted,
`budget_policy.verification_command_timeout_sec` may provide the same bound. If
both are omitted, AOR uses the command group's `timeout_class` default before
falling back to the implementation default. The timeout is per target command,
not a whole-lifecycle or provider-run budget. Long-running timeout budgets are
separate from hang cleanup evidence.

`writeback_policy.default_delivery_mode` should resolve to one of the delivery-plan modes:
- `no-write`
- `patch-only`
- `local-branch`
- `fork-first-pr`

Non-canonical aliases are rejected instead of normalized.

## Example
See `examples/project.aor.yaml`, `examples/project.github.aor.yaml`,
`examples/project.bounded-multirepo.aor.yaml`, and
`examples/project.verification-archetypes.aor.yaml`.
