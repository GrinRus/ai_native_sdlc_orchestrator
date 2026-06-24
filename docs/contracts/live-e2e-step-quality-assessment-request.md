# Live E2E step quality assessment request

## Purpose
Per-step runner request for an external live E2E evaluator to assess one observed
public SDLC step before product-change continuation.

The request is built only from public AOR evidence: command transcripts,
observation artifacts, operator decision artifacts, control-plane reports, UI
proof, and target checkout evidence. It is not AOR private state and must not
grant permission to mutate the target repository.

For `mission_class=product-change` with `feature_size=medium|large|xlarge`, the
runner must stop after writing this request until a linked accepted
`live-e2e-step-quality-assessment-report` exists. For
`mission_class=flow-regression` with `feature_size=small`, the runner may use the
request as lightweight flow-health evidence.

## Required fields
- `request_id`
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
- `requested_assessment_method`
- `rubric_version`
- `rubric`
- `evaluator_input_refs`
- `expected_assessment_report_file`
- `evidence_refs`

## Enums
`requested_assessment_method` is one of:
- `flow-health-automatic`
- `external-skill-agent`
- `manual-skill-agent`

Medium+ product-change requests must use `external-skill-agent` or
`manual-skill-agent`; `flow-health-automatic` is small-canary only.

## Boundary
The evaluator may inspect refs listed in `evaluator_input_refs[]` and
`evidence_refs[]`. Repair recommendations must route through the public AOR
review/repair loop and must not include private patches, direct target checkout
edits, or private handoff/spec mutations.
