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
- `verification_plan`
- `status`

## Notes
The analysis report should be repeatable and durable. It feeds validate/verify, live E2E preflight, and onboarding guidance recommendations.
`route_resolution` must expose deterministic default-route and override application for every supported step class.
`asset_resolution` must expose the wrapper and prompt-bundle provenance attached to each resolved route.

## Example
See `examples/project-analysis-report.sample.yaml`.
