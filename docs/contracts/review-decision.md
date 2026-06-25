# Review decision

## Purpose
Durable approval decision for one reviewed run.

`review-report` remains the report-only quality verdict. `review-decision` records an explicit operator decision that downstream delivery and release gates can inspect without reinterpreting narrative review fields.

## Required fields
- `decision_id`
- `project_id`
- `run_id`
- `decision`
- `decider_ref`
- `reason`
- `review_report_ref`
- `runtime_harness_report_ref`
- `delivery_manifest_refs`
- `learning_handoff_refs`
- `decision_basis`
- `repair_context`
- `delivery_gate`
- `evidence_refs`
- `decided_at`

## Decision vocabulary
`decision` must use:
- `approve`
- `hold`
- `request-repair`

`approve` is only valid when the linked `review-report.overall_status` is `pass` and the linked `runtime-harness-report.overall_decision` is `pass`.

`hold` preserves a human stop without claiming repair has started.

`request-repair` records that downstream work should repair the linked run before delivery/release approval.
For public repair loops, `request-repair` must preserve structured
`repair_context` in addition to the operator-readable reason. The context
records `source_phase`, `cycle_iteration`, `unresolved_findings`,
`unresolved_finding_details`, `meaningful_changed_paths`,
`verification_status`, `verification_refs`, `previous_repair_decision_refs`,
`context_fingerprint`, `new_context_since_previous`, `stop_reason`, and
`requested_next_step`.
It must still route repair through public AOR run/review lifecycle commands
rather than providing a private patch or direct target mutation.

## Decision basis
`decision_basis` should preserve:
- `review_overall_status`
- `review_recommendation`
- `runtime_harness_overall_decision`
- `blocking_findings`

## Repair context
`repair_context` is always present. For `approve` and `hold`, it records
`source_phase=none`, `cycle_iteration=0`, and empty evidence arrays. For
`request-repair`, it records the phase that requested repair (`review`, `qa`,
`post-run-primary`, or `post-run-diagnostic`), the quality-cycle iteration,
unresolved findings, structured unresolved finding details, changed paths,
verification status and refs, prior repair decision refs, a deterministic
context fingerprint, the new evidence/context seen since the previous repair,
the stop reason, and the requested next step. `request-repair` is invalid when
this context is empty, omits structured finding details or the fingerprint,
repeats prior repair lineage without new context, or points anywhere other than
`execution` as the next public repair step.

Each `repair_context.unresolved_finding_details[]` entry must include
`finding_id`, `category`, `severity`, `summary`, `evidence_refs`, and
`resolution_requirement`. The `finding_id` should remain stable across repair
iterations so the runner can distinguish a stale finding from a provider repair
that did not address the finding. `resolution_requirement` must be concrete
enough for the next execution packet to prove closure; for example, coverage
weakening findings should require restoring the weakened assertion or plan
coverage, or adding equivalent stronger coverage with final diff and
verification evidence.

## Delivery gate
`delivery_gate` should preserve:
- `status` (`pass|blocked`)
- `blocks_downstream`
- `required_downstream_decision`
- `findings`

Delivery and release commands that opt into the review-decision gate must require the latest run-linked `review-decision` to be `approve`; `hold` and `request-repair` must block.

## Boundary rules
- `review-decision` must not replace deterministic validation, evaluation, Runtime Harness diagnosis, or delivery manifests.
- The artifact may reference delivery manifests and learning-loop handoffs when they already exist, but it must be valid before delivery artifacts exist.
- The artifact is append-only decision evidence; later decisions create a new artifact rather than mutating prior approvals.
