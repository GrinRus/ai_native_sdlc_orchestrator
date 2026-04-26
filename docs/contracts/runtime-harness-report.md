# Runtime harness report

## Purpose
Completed-run diagnosis artifact for the AOR Runtime Harness.

The report records how AOR controlled the run, not the feature result by itself. It aggregates routed step decisions, failure classes, mission semantics, repair attempts, verification status, unresolved gaps, and follow-up recommendations. Feature quality remains owned by `review-report`, suite quality remains owned by `evaluation-report`, delivery lineage remains owned by delivery/release artifacts, learning closure remains owned by learning-loop artifacts, and platform asset lifecycle decisions remain owned by `promotion-decision`.

## Required fields
- `report_id`
- `project_id`
- `run_id`
- `generated_at`
- `mission_type`
- `strictness_profile`
- `overall_decision`
- `step_decisions`
- `run_findings`
- `recommendations`
- `impacted_asset_refs`
- `promotion_recommendations`
- `unresolved_gaps`
- `evidence_refs`

## Decision semantics
`overall_decision` must use:
- `pass`
- `retry`
- `repair`
- `escalate`
- `block`
- `fail`

`mission_type` should use the closest applicable value:
- `code-changing`
- `docs-only`
- `no-write-rehearsal`
- `release`
- `asset-certification`
- `unknown`

`strictness_profile` should name how semantic gaps are interpreted:
- `strict-code-changing`
- `strict-release`
- `soft-docs`
- `soft-no-write`
- `asset-certification`
- `unknown`

## Step decision expectations
Each `step_decisions[]` entry should preserve:
- `step_id`
- `step_class`
- `compiled_context_ref`
- `adapter_status`
- `failure_class`
- `mission_outcome` (`satisfied|not_satisfied|not_applicable|unknown`)
- `runtime_harness_decision` (`pass|retry|repair|escalate|block|fail`)
- `repair_attempts`
- `verification_status`
- `stage_timings`
- `mission_semantics`
- `evidence_refs`

`repair_attempts` is the durable Runtime Harness ledger for a non-pass decision. It should preserve the trigger, failure class, selected policy action, input evidence refs, route/compiled-context refs when a repair route is executed, budget match/exhaustion metadata, and the attempt result. If a step has not yet executed repair, the ledger may contain a pending attempt with `result=not_started`. When repair executes, the repair step's compiled context should receive a generated repair input evidence ref containing previous findings, failed transcripts/evidence, diff status, adapter evidence, validator findings, and the current report ref. Exhausted budgets should be machine-readable through `result=exhausted` and `exhausted_budget=true`.

`failure_class` should use stable machine-readable values when known, including:
- `provider-timeout`
- `auth-failure`
- `permission-mode-blocked`
- `edit-denied`
- `interactive-question-requested`
- `no-op`
- `schema-mismatch`
- `missing-evidence`
- `validation-failed`
- `repo-scope-violation`
- `eval-failed`
- `review-failed`
- `delivery-empty-patch`
- `runtime-failed`
- `unknown`

`mission_semantics` records the run-level semantic evidence used by the Runtime Harness for the step decision, including `changed_paths`, `non_bootstrap_changed_paths`, and whether strict code-changing no-op detection was applied.
When an intake request declares `allowed_paths` or `forbidden_paths`, semantic validation must ignore the request input file itself, derive `mission_scoped_changed_paths`, and record `scope_violation_paths` for changed paths outside the allowed scope or inside forbidden scope.

## Boundary rules
- Runtime Harness reports diagnose AOR runtime behavior and may recommend recertification, but they do not promote or freeze assets.
- Strict delivery and release commands must treat an empty `step_decisions[]` set as missing Runtime Harness execution evidence, not as a pass.
- Learning handoff may link a Runtime Harness report and carry next actions, but it does not replace this report.
- Asset certification commands may link a run for provenance, but certification evidence remains fresh and separate from run diagnosis.
- Live E2E summaries should reference this report when proving the installed-user journey.
