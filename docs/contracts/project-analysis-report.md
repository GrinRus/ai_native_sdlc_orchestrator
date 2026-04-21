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
- `verification_plan`
- `status`

## Notes
The analysis report should be repeatable and durable. It feeds validate/verify, live E2E preflight, and onboarding guidance recommendations.

## Example
See `examples/project-analysis-report.sample.yaml`.
