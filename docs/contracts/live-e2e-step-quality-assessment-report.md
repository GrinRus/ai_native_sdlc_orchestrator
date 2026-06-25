# Live E2E step quality assessment report

## Purpose
Per-step black-box quality report written by the external live E2E evaluator
after inspecting public AOR artifacts for one observed SDLC step.

The report is runner/evaluator evidence, not AOR private state. It may inspect public command transcripts, control-plane artifacts, reports, UI proof, and target checkout evidence. It must not mutate the target repository, inject patches, or bypass the public AOR review/repair loop.

For `mission_class=product-change`, every medium, large, and xlarge step must
have an accepted step-quality assessment linked to a
`live-e2e-step-quality-assessment-request` before the runner continues to the
next public step. For `mission_class=flow-regression`, the report may be
lightweight flow-health evidence for small canary profiles.

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
- `source_assessment_request_file`
- `assessment_method`
- `rubric_version`
- `evaluator_input_refs`
- `evaluator_output_ref`
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

`assessment_method` is one of:
- `flow-health-automatic`
- `external-skill-agent`
- `manual-skill-agent`

Medium+ product-change accepted reports must use `external-skill-agent` or
`manual-skill-agent`. `flow-health-automatic` is valid only for small
flow-regression canaries.

## Required Dimensions
`dimensions` must contain:
- `traceability`
- `completeness`
- `actionability`
- `evidence_strength`
- `black_box_boundary`

For accepted `mission_class=product-change` reports with `step_id=execution`
or `step_id=review`, `dimensions` must also contain:
- `mission_relevance`
- `verification_relevance`
- `repair_necessity`

For accepted `mission_class=product-change` reports with `step_id=qa`,
`dimensions` must also contain:
- `verification_relevance`
- `regression_signal_quality`
- `mission_relevance`
- `repair_necessity`

Each dimension contains:
- `status`
- `evidence_strength`
- `summary`
- `inspected_evidence_refs`
- `findings`

Accepted reports require every dimension to be `status=pass` with
`evidence_strength=medium|strong`. Product-change accepted reports also require
non-empty dimension summaries, non-empty dimension findings, and non-empty
inspected refs so continuation is based on evidence-backed rationale rather
than an auto-pass wrapper. Top-level findings, dimension summaries, and
dimension findings must be substantive rationale strings; superficial values
such as `ok`, `pass`, or other one-word placeholders are rejected even when the
report is otherwise structurally valid.

The execution/review-specific dimensions must explicitly assess whether the
observed target diff is relevant to the mission, whether verification evidence
covers the changed behavior, and whether the next action should continue or
request public AOR repair. The QA-specific dimensions must explicitly assess
verification relevance, regression signal quality, mission relevance, and repair
necessity before delivery. They are still evaluator observations: they must not
include private patches, direct target mutations, or hidden handoff rewrites.

## Repair Boundary
If `decision=request-repair`, `repair_instructions[]` must direct the runner back through the public AOR review/repair loop. The evaluator must not provide a private patch, private spec rewrite, direct handoff mutation, or direct target checkout edit.

Reports must include `repair_lineage` with the source step-quality request,
source operator decision, step iteration, and public repair command whenever
`decision=request-repair`. This lineage is evaluator/runner evidence only and
does not authorize private target mutation.
