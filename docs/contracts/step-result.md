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
Execution engines may add replay metadata (for example route/asset/policy/adapter selections, timestamps, dry-run mode, and blocked-next-step guidance) as optional fields.
Routed execution outputs may also include `routed_execution.context_compilation` diagnostics that capture compiled-context fingerprint, selected skill refs, included sources, dropped sources, and required-input resolution status.

For MVP validation, `step_class` is a closed set:
- `artifact`
- `planner`
- `runner`
- `repair`
- `eval`
- `harness`
