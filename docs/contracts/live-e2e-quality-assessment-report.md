# Live E2E quality assessment report

## Purpose
Outcome-oriented quality report written after a full live E2E flow by the launching SWE agent.

This report is separate from the run itself. It assesses the quality of the artifacts produced by the flow, the resulting code and verification evidence, delivery safety, and AOR operator UI/UX/accessibility evidence where applicable. It is advisory for qualification and acceptance unless a separate policy explicitly consumes it.

The assessment is free-form expert work over the linked evidence. It does not rely on predefined fixtures.

`quality-assessment prepare` is valid only after a completed declared flow. The source run-health status must be `pass` or `warn`, and the source observation status must be `pass` or `warn`. Blocked or failed runs, including `compiled_context_budget_exceeded`, stop at factual run-health reporting and must not produce an outcome quality assessment request.

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
- `aor_operator_ui_ux_quality`
- `aor_operator_accessibility_quality`
- `evidence_strength`
- `acceptance_criteria_traceability`

Each dimension contains:
- `status`
- `evidence_strength`
- `inspected_evidence_refs`
- `findings`
- `recommended_followups`

`aor_operator_ui_ux_quality` must include `subdimensions`:
- `task_success`
- `flow_navigation_clarity`
- `next_action_clarity`
- `blocker_and_error_understandability`
- `recovery_affordance`
- `state_feedback_loading_empty_error`
- `visual_stability_responsiveness`
- `raw_json_independence`

`aor_operator_accessibility_quality` must include `subdimensions`:
- `keyboard_navigation`
- `focus_order`
- `contrast_and_readability`
- `semantic_structure`
- `screen_reader_labels`
- `accessible_error_feedback`

Each subdimension contains:
- `status`
- `evidence_strength`
- `evidence_refs`
- `findings`

Subdimensions use the same status and evidence-strength vocabularies as dimensions. Evaluated subdimensions must cite non-empty `evidence_refs[]`. `not_evaluated` subdimensions must use `evidence_strength: missing` and include at least one finding explaining the gap.

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
- `aor_operator_ui_ux_quality`: installed-user task success, flow navigation clarity, next-action clarity, blocker/error understandability, recovery affordance, state feedback for loading/empty/error states, visual stability/responsiveness, and whether the operator can proceed without reading raw JSON.
- `aor_operator_accessibility_quality`: keyboard navigation, focus order, contrast/readability, semantic structure, screen-reader labels, and accessible error feedback for the AOR operator experience.
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

## AOR operator UI/UX expectations
The UI/UX dimensions assess only the AOR operator and installed-user experience. Repository-owned frontend behavior is assessed through implementation and verification dimensions when a mission requires it.

`aor app --smoke` and deterministic render markers are render guardrails, not UX proof. Strong AOR operator UI/UX evidence requires browser/task inspection or explicit SWE inspection citing concrete refs for task success, navigation, next actions, blockers, recovery, visual/responsive behavior, and accessibility. Missing or indirect UI evidence must be reported as `weak` or `not_evaluated`.

Headless target-project runs may cite a paired guided AOR operator UI proof from
the same AOR commit for `aor_operator_ui_ux_quality` and
`aor_operator_accessibility_quality`, because those dimensions assess the AOR
operator experience rather than the checked repository UI. The paired proof must
be referenced explicitly by the assessment request and report evidence refs.

## All-pass policy
Contract validity is not the same as strict quality closure. Use the separate
gate when a run must prove outcome quality:

```bash
node ./scripts/live-e2e/quality-assessment.mjs gate \
  --policy all-pass \
  --assessment-report-file <report>
```

The gate is advisory and does not mutate run-health or provider qualification.
It fails when:
- the report contract or local evidence refs are invalid;
- `overall_status` is not `pass`;
- any required dimension or AOR operator subdimension is not `pass`;
- any dimension or subdimension uses `evidence_strength: weak|missing`;
- `gap_report.not_evaluated_dimensions` or `gap_report.weak_signal_dimensions`
  is non-empty;
- blocker, critical, high, or major findings remain;
- the source run summary has no meaningful target changed path outside `.aor/`.

Under all-pass, `security_review` and `performance_regression_risk` must be
explicitly evaluated with medium or strong evidence. AOR operator UI/UX and
accessibility must cite guided/browser-task evidence, either from the same run or
from a paired guided AOR operator proof for the same AOR commit.

## Forbidden fields
Quality assessment reports must not include old runner aggregation fields:
- `quality_judgement`
- `runner_quality_summary`
- `final_skill_agent_verdict`
- `canonical_status`
- `acceptance_status`
- `coverage_status`
- `ui_ux_quality`
- `accessibility_quality`
- `target_ui_ux_quality`
