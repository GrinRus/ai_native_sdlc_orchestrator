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
- `status`

## Notes
The analysis report should be repeatable and durable. It feeds validate/verify, live E2E preflight, and onboarding guidance recommendations.
`route_resolution` must expose deterministic default-route and override application for every supported step class.
`asset_resolution` must expose the wrapper and prompt-bundle provenance attached to each resolved route.
`policy_resolution` must expose deterministic policy merge precedence and resolved bounds before any adapter invocation.
`evaluation_registry` should expose discoverable suite and dataset refs so eval/certification flows can resolve assets by ID without ad hoc file lookups.
`discovery_completeness` should expose explicit pass/fail checks for later-stage readiness (route/asset/policy coverage and evaluation-registry availability).
`architecture_traceability` should link step coverage back to architecture docs and contract refs used by discovery/spec planning workflows.

## Example
See `examples/project-analysis-report.sample.yaml`.
