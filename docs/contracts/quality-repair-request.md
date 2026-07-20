# Quality repair request

## Purpose
Shared public artifact that turns review-origin or QA-origin findings into one
bounded repair cycle.

`quality-repair-request` is source-of-truth repair intent. Review reports,
review decisions, QA reports, step results, Runtime Harness reports, and
next-action reports may copy optional lineage from it, but they do not own the
repair cycle.

## Required fields
- `request_id`
- `project_id`
- `run_id`
- `cycle_id`
- `source_stage`
- `source_ref`
- `finding_refs`
- `repair_scope`
- `attempt_budget`
- `status`
- `blockers`
- `evidence_refs`
- `created_at`

## Source stage
`source_stage` must use:
- `review`
- `qa`

`source_ref` points to the review or QA evidence that requested repair.
`finding_refs[]` points to the stable finding ids or evidence refs that must be
closed before delivery can continue.

`origin_context` is optional additive lineage for scheduled execution. It may
carry `parent_run_id`, `execution_unit_id`, `integration_gate_id`, and
`input_fingerprint`. It never changes `source_stage`, status transitions, or
the policy-owned attempt budget.

## Repair scope
`repair_scope` should preserve:
- `target_step`, normally `implement` or `repair`;
- `requested_next_step`, normally public execution rather than a private patch;
- `allowed_paths[]` when an approved handoff or operator scope constrains the
  repair;
- `verification_refs[]` and `required_evidence_refs[]` that must be refreshed
  before the cycle can close;
- `compiled_context_refs[]` after a repair step has been prepared;
- `reason`, a short operator-readable summary.

The request is runner-agnostic. It may cite prompt/context and evidence refs,
but it must not embed provider-specific instructions, private harness fields,
or direct source patches.

## Attempt budget
`attempt_budget` makes the cycle budget policy-driven:
- `policy_ref`
- `max_attempts`
- `attempt_index`
- `remaining_attempts`

`max_attempts` comes from the project profile or selected runtime policy. The
contract does not define a hardcoded default.

## Status
`status` must use:
- `requested` when the repair request exists but repair execution has not
  started.
- `in-progress` when the repair implementation step is running or pending
  completion.
- `review-required` when a repair attempt completed and must be reviewed before
  QA or delivery.
- `qa-required` when post-repair review passed and QA is in scope.
- `budget-exhausted` when no policy-approved attempts remain.
- `closed` when review and any required QA evidence prove closure.

Downstream delivery and release remain blocked while a required repair request
is `requested`, `in-progress`, `review-required`, `qa-required`, or
`budget-exhausted`. A `budget-exhausted` request may be bypassed only by an
explicit operator approval artifact referenced from `operator_override_ref`.

## Public closure transition

`aor repair close` is the canonical public mutation for closing a repair
request. It requires matching project, run, and request identities plus the
refreshed evidence refs that prove the repair cycle completed. The mutation
fails closed unless the latest review and Runtime Harness evidence pass. A
request originating from QA, or currently in `qa-required`, also requires an
explicit QA evidence ref.

The transition is idempotent for an already closed matching request. Requests
in `requested`, `in-progress`, or `budget-exhausted` cannot be closed. Internal
rehearsal tooling must call this public mutation rather than updating the
artifact or importing observability helpers directly.

## Status history
`status_history[]` may record status transitions with `status`, `changed_at`,
`summary`, and `evidence_refs[]`. It is additive read evidence; the current
state remains the top-level `status`.

## Lineage fields on downstream reports
Downstream reports may add the optional object `quality_repair_lineage`:
- `request_ref`
- `cycle_id`
- `source_stage`
- `status`
- `attempt_index`
- `evidence_refs[]`

`review-decision` may also add `quality_repair_request_ref` for the request it
created or accepted. These fields are optional for backward compatibility; old
reports and decisions without repair lineage remain valid.

## Compiled prompt and context inputs
When a repair implementation step is prepared, the context compiler includes
the repair request as a normal packet/evidence input:
- `compiled-context.packet_refs[]` includes a stable
  `packet://quality-repair-request@evidence://...` ref when the request is
  materialized.
- The selected repair prompt bundle receives the request ref, source finding
  refs, required evidence refs, and attempt budget through compiled context.
- Provider-facing work packets may summarize the request, but the durable
  request artifact and compiled-context ref remain the auditable source.

This path follows the same route, wrapper, prompt bundle, context bundle,
policy, and adapter resolution as other routed steps. It does not introduce
provider-specific behavior or a private repair channel.

## Example
See `examples/reports/quality-repair-request*.yaml`.
