# Live E2E quality assessment report

## Purpose
Outcome-oriented quality report written after a full live E2E flow by the launching SWE agent.

This report is separate from the run itself. It assesses the quality of the artifacts produced by the flow, the resulting code and verification evidence, delivery safety, and UI/UX/accessibility evidence where applicable. It is advisory for qualification and acceptance unless a separate policy explicitly consumes it.

The assessment is free-form expert work over the linked evidence. It does not rely on predefined fixtures.

## Required fields
- `assessment_id`
- `run_id`
- `profile_id`
- `generated_at`
- `evaluator`
- `source_run_summary_file`
- `source_observation_report_file`
- `source_run_health_report_file`
- `overall_status`
- `dimensions`
- `gap_report`
- `findings`
- `recommended_followups`
- `evidence_refs`

`evaluator.kind` must be `swe-agent`.

## Status and evidence strength
`overall_status` and every dimension status must be one of:
- `pass`
- `warn`
- `fail`
- `not_evaluated`

Every dimension must declare `evidence_strength`:
- `strong`
- `medium`
- `weak`
- `missing`

Dimensions with `pass`, `warn`, or `fail` must include non-empty `inspected_evidence_refs[]`.

Dimensions with `not_evaluated` must use `evidence_strength: missing` and include at least one finding explaining why the dimension was not evaluated.

If evidence strength is `missing`, the dimension status must be `not_evaluated`.

## Required dimensions
`dimensions` must contain:
- `artifact_content_quality`
- `implementation_correctness`
- `implementation_completeness`
- `code_maintainability`
- `test_adequacy`
- `security_review`
- `performance_regression_risk`
- `verification_quality`
- `delivery_safety`
- `ui_ux_quality`
- `accessibility_quality`
- `evidence_strength`
- `acceptance_criteria_traceability`

Each dimension contains:
- `status`
- `evidence_strength`
- `inspected_evidence_refs`
- `findings`
- `recommended_followups`

## Dimension rubric
The SWE evaluator should inspect outcome quality against these stable concerns:

- `artifact_content_quality`: completeness, contradictions, verifiability, KPI/DoD traceability, execution readiness, and architectural coherence of discovery, spec, handoff, review, delivery, and release artifacts.
- `implementation_correctness`: semantic behavior against the mission, API compatibility, edge cases, error handling, and whether evaluation evidence actually covers the requested user-facing outcome.
- `implementation_completeness`: every KPI, Definition of Done item, acceptance criterion, and mission-scoped required path is either satisfied with evidence or called out as missing.
- `code_maintainability`: architecture boundary fit, dependency use, dead or duplicated code, unsafe abstractions, semantic feature-size fit, and readability of the final diff.
- `test_adequacy`: changed-source coverage, target command relevance, regression sensitivity, and whether tests were weakened or bypassed.
- `security_review`: secrets, injection risks, authn/authz changes, unsafe file or network access, dependency exposure, and data handling.
- `performance_regression_risk`: latency, memory, bundle size, query complexity, render cost, and other mission-relevant regression risks.
- `verification_quality`: strength of project verify, Runtime Harness, eval, review, and release evidence; default eval reports are supporting evidence unless mission coverage was inspected directly.
- `delivery_safety`: no-upstream-write proof, delivery manifest correctness, rollback or recovery guidance, bounded write-back mode, and release packet safety.
- `ui_ux_quality`: target product UI/UX when a target UI exists, AOR operator UI separately, task success, copy clarity, responsive visual evidence, loading/empty/error/recovery states, and visual overlap risks.
- `accessibility_quality`: keyboard navigation, focus order, contrast, screen-reader semantics, axe-style evidence, and accessibility checklist limits.
- `evidence_strength`: whether the assessment itself has strong, medium, weak, missing, or indirect signals across dimensions.
- `acceptance_criteria_traceability`: explicit mapping from criteria/KPI/DoD to evidence refs, with uncovered criteria listed as findings.

## Finding taxonomy
Findings must use one of:
- `artifact-content`
- `implementation-correctness`
- `test-adequacy`
- `security`
- `performance`
- `ui-ux`
- `accessibility`
- `evidence-gap`
- `acceptance-traceability`
- `follow-up-needed`

Each finding should include:
- `category`
- `severity`
- `summary`
- `evidence_refs`

## Gap report
`gap_report` must make signal strength explicit:
- `not_evaluated_dimensions`
- `weak_signal_dimensions`
- `strong_evidence_dimensions`

The report must call out where evidence was not inspected, where it was weak or indirect, and where evidence was strong enough to support the judgement. These arrays must match the dimension records: `not_evaluated_dimensions` lists every dimension with `status=not_evaluated`, `weak_signal_dimensions` lists every dimension with `evidence_strength=weak`, and `strong_evidence_dimensions` lists every dimension with `evidence_strength=strong`.

## UI/UX expectations
The assessment must distinguish:
- AOR operator UI quality
- target product UI quality

`aor app --smoke` and deterministic render markers are render guardrails, not UX proof. UI/UX assessment should inspect task success, copy clarity, recovery states, visual evidence, responsive behavior, and accessibility evidence, or mark the dimension `not_evaluated`.

## Forbidden fields
Quality assessment reports must not include old runner aggregation fields:
- `quality_judgement`
- `runner_quality_summary`
- `final_skill_agent_verdict`
- `canonical_status`
- `acceptance_status`
- `coverage_status`
