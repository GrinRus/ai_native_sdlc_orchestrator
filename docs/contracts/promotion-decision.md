# Promotion decision

## Purpose
Durable decision record that moves a platform asset or route between draft, candidate, stable, frozen, or demoted states.

## Required fields
- `decision_id`
- `subject_ref`
- `from_channel`
- `to_channel`
- `evidence_refs`
- `evidence_summary`
- `status`

## Notes
Promotion decisions should always point to certification evidence and approver context when needed.
`status` semantics for certification baseline:
- `pass` — evidence bar is fully satisfied; promotion can proceed.
- `hold` — evidence is incomplete or incompatible; promotion must wait.
- `fail` — evidence shows regression/risk above threshold; promotion is denied.

`evidence_summary` should name the exact deterministic + evaluative artifacts used in the decision:
- deterministic evidence:
  - `deterministic_validation_report_ref`
  - `deterministic_validation_status` (`pass|warn|fail`)
- evaluative evidence:
  - `evaluation_report_ref`
  - `harness_capture_ref`
  - `harness_replay_ref`
  - `replay_evaluation_report_ref` (optional when replay is not comparable yet)

Governance guardrail semantics should be explicit and reproducible:
- `governance_checks[]` should include per-check `check_id`, `status` (`pass|hold|fail`), and a stable summary.
- include `policy-quality-gate` so blocked decisions are traceable to policy, not just final status.
- include `baseline-comparison` when moving into `stable`, `frozen`, or `demoted`.
- include `regression-triage` when baseline comparison is required.
- include `freeze-channel-guardrail` when `to_channel=frozen`.

Baseline comparison evidence should be explicit for maturity decisions:
- `baseline_comparison.baseline_status`
- `baseline_comparison.baseline_pass_rate`
- `baseline_comparison.candidate_status`
- `baseline_comparison.candidate_pass_rate`
- `baseline_comparison.pass_rate_delta`
- `baseline_comparison.comparison_ready`
- `baseline_comparison.drift_detected`
- `baseline_comparison.drift_severity` (`none|minor|major`)
- `baseline_comparison.flaky_detected`
- `baseline_comparison.regression_detected`
- `baseline_comparison.triage_recommendation`
- `baseline_comparison.escalation_required`
- `baseline_comparison.baseline_evaluation_report_ref`
- `baseline_comparison.replay_evaluation_report_ref` (optional if replay is blocked)

Regression triage metadata should be explicit for operator review:
- `regression_triage.compared_metric`
- `regression_triage.pass_rate_delta`
- `regression_triage.drift_detected`
- `regression_triage.drift_severity`
- `regression_triage.flaky_detected`
- `regression_triage.regression_detected`
- `regression_triage.triage_recommendation`
- `regression_triage.escalation_required`
- `regression_triage.escalation_channel`
- `regression_triage.replay_status`

Controlled rollout semantics should be explicit:
- `rollout_decision.action` should be one of `promote`, `hold`, `reject`, `freeze`, or `demote`.
- `rollout_decision.requested_transition` records `from_channel` and `to_channel`.
- `rollout_decision.baseline_comparison_required` and `rollout_decision.baseline_comparison_complete` make promotion/freeze requirements auditable.
- `rollout_decision.freeze_guardrail_required` and `rollout_decision.freeze_guardrail_satisfied` document freeze escalation behavior.

Finance evidence parity should be carried in decision evidence:
- `finance_signals.max_cost_usd`
- `finance_signals.timeout_sec`
- `finance_signals.capture_latency_sec`
- `finance_signals.replay_latency_sec`
- optional source fields (`max_cost_source`, `timeout_source`) for audit provenance.

`evidence_bar.required` should include deterministic validation, evaluative artifacts, and finance signals when policy quality gate is required.
For maturity transitions:
- include `baseline-comparison` for `stable`, `frozen`, and `demoted`;
- include `regression-triage` for `stable`, `frozen`, and `demoted`;
- include `freeze-guardrail` for `frozen`.

For MVP validation, `from_channel` and `to_channel` use this closed set:
- `draft`
- `candidate`
- `stable`
- `frozen`
- `demoted`

For MVP validation, `status` uses this closed set:
- `pass`
- `hold`
- `fail`

## Example
See `examples/packets/promotion-decision-wrapper-pass.yaml`.
