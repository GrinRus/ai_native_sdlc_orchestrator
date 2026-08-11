# Quality repair attempt

`quality-repair-attempt` is the immutable execution lineage for one bounded
quality-repair retry. The parent `quality-repair-request` owns the lifecycle;
an attempt records the reservation, owned workspace, fingerprints, budget
lineage, and terminal evidence without overwriting an earlier attempt.

## Required fields

- `attempt_id`, `request_id`, `cycle_id`, `attempt_index`
- `trigger` (`operator-retry` or another auditable trigger)
- `repair_run_id`
- `status` (`reserved|running|completed|failed|blocked|canceled`)
- `workspace_ref`
- `input_fingerprint`, `finding_fingerprint`, `failure_fingerprint`
- `created_at`, `updated_at`, `evidence_refs[]`

Optional lineage includes `parent_attempt_ref`, `route_ref`, `failure_class`,
`diff_fingerprint`, `workspace_owner`, `base_commit`, `owned_workspace`,
`budget`, `lineage`, `review`, and `qa`.

The retry mutation is idempotent by `command_id` and protects the parent
request with `expected_revision`. It reserves a single attempt under a file
lock, writes the immutable attempt and parent request together, and only marks
the budget as debited after a later launch acknowledgement. A request may have
at most one `reserved` or `running` attempt.

Execution must continue in the owner-marked disposable workspace. The primary
checkout, an external root, a missing root, a symlink, a different project, or
a changed input/diff fingerprint is rejected before provider spawn. An
identical failure fingerprint is rejected with
`repeated-repair-without-new-evidence` unless new evidence, a route change, an
explicit budget decision, or an operator hold is supplied.

Retry is allowed only for a `requested` request with a terminal prior attempt
and remaining policy budget. `review-required`, `qa-required`, `budget-exhausted`,
`closed`, `in-progress`, and an active attempt are blocked. A completed
write-capable attempt returns to the parent request's review and QA gates.

See `examples/reports/quality-repair-attempt*.yaml`.
