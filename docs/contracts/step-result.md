# Step result

## Purpose
Normalized output of one step regardless of whether that step was an artifact, planner, runner, repair, eval, or harness step.

## Required fields
- `step_result_id`
- `run_id`
- `step_id`
- `step_class`
- `status`
- `summary`
- `evidence_refs`

## Notes
Step results make routing, validation, and quality logic consistent across the lifecycle.

For MVP validation, `step_class` is a closed set:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`
