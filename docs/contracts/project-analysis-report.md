# Project analysis report

## Purpose
Materialized bootstrap output describing the target repository: topology, commands, service boundaries, risk zones, missing prerequisites, and recommended local guidance.

## Required fields
- `report_id`
- `project_id`
- `version`
- `generated_from`
- `repo_facts`
- `toolchain_facts`
- `command_catalog`
- `route_resolution`
- `asset_resolution`
- `policy_resolution`
- `verification_plan`
- `discovery_research`
- `status`

## Notes
The analysis report should be repeatable and durable. It feeds validate/verify, runtime preflight, and onboarding guidance recommendations.
`route_resolution` must expose deterministic default-route and override application for every supported step class.
`asset_resolution` must expose the wrapper and prompt-bundle provenance attached to each resolved route.
`policy_resolution` must expose deterministic policy merge precedence and resolved bounds before any adapter invocation.
`evaluation_registry` should expose discoverable suite and dataset refs so eval/certification flows can resolve assets by ID without ad hoc file lookups.
`discovery_completeness` should expose explicit pass/fail checks for later-stage readiness (route/asset/policy coverage and evaluation-registry availability).
`architecture_traceability` should link step coverage back to architecture docs and contract refs used by discovery/spec planning workflows.
`repo_scope_proof` should expose the declared profile topology, repo list, repo graph, impacted repo scope, per-repo validation evidence refs, integration validation refs, and whether coordination is required. For bounded multirepo profiles this is the machine-readable proof that backend, mobile, frontend, or other repo entries are handled through the same project-profile contract path as single-repo and monorepo projects.
`discovery_research` should summarize the ADR-ready discovery research report that links repository facts, runtime context assets, local research inputs, open questions, and ADR candidate recommendations before spec handoff.
`toolchain_facts.stack_discovery` should expose detected stack signals, package boundaries, generic outcomes such as `no-tests`, and custom suggestions without running target commands.
`command_catalog.command_group_candidates[]` should expose discovered generic command-group candidates with confidence, source refs, and W54 authoring metadata for later profile materialization.
Guided onboarding should reference project-analysis evidence instead of duplicating repository facts. W21-S03 owns the additive onboarding-report shape for asset mode, readiness, blockers, next action, and no-surprise-write evidence.

## Example
See `examples/project-analysis-report.sample.yaml`.
