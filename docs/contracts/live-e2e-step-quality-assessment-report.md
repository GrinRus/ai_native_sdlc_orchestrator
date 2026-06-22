# Live E2E step quality assessment report

## Purpose
Per-step black-box quality report written by the external live E2E evaluator after inspecting public AOR artifacts for one observed SDLC step.

The report is runner/evaluator evidence, not AOR private state. It may inspect public command transcripts, control-plane artifacts, reports, UI proof, and target checkout evidence. It must not mutate the target repository, inject patches, or bypass the public AOR review/repair loop.

For `mission_class=product-change`, every medium, large, and xlarge step must have an accepted step-quality assessment before the runner continues to the next public step. For `mission_class=flow-regression`, the report may be lightweight flow-health evidence for small canary profiles.

## Required fields
- `assessment_id`
- `run_id`
- `profile_id`
- `generated_at`
- `evaluator`
- `target_catalog_id`
- `feature_mission_id`
- `feature_size`
- `mission_class`
- `step_id`
- `step_name`
- `step_iteration`
- `source_agent_decision_request_file`
- `source_operator_decision_file`
- `status`
- `decision`
- `dimensions`
- `findings`
- `repair_instructions`
- `inspected_evidence_refs`
- `evidence_refs`

## Enums
`feature_size` is one of `small`, `medium`, `large`, `xlarge`. The legacy `xl` alias is rejected.

`mission_class` is one of:
- `flow-regression`
- `product-change`

`status` is one of:
- `accepted`
- `request_repair`
- `retry`
- `blocked`

`decision` is one of:
- `continue`
- `request-repair`
- `retry`
- `block`

Accepted reports must use `decision=continue`.

## Required Dimensions
`dimensions` must contain:
- `traceability`
- `completeness`
- `actionability`
- `evidence_strength`
- `black_box_boundary`

Each dimension contains:
- `status`
- `evidence_strength`
- `inspected_evidence_refs`
- `findings`

Accepted reports require every dimension to be `status=pass` with `evidence_strength=medium|strong`.

## Repair Boundary
If `decision=request-repair`, `repair_instructions[]` must direct the runner back through the public AOR review/repair loop. The evaluator must not provide a private patch, private spec rewrite, direct handoff mutation, or direct target checkout edit.
