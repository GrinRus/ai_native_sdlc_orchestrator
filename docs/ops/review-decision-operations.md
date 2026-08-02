# Review decision operations

## Purpose
Review decisions turn report-only review evidence into a durable approval state that delivery and release gates can inspect.

## Command sequence
Run review first:

```bash
aor review run \
  --project-ref <repo> \
  --run-id <run_id>
```

Record the operator decision:

```bash
aor review decide \
  --project-ref <repo> \
  --run-id <run_id> \
  --decision approve \
  --reason "Review and Runtime Harness evidence pass."
```

Use `hold` when the operator needs a deliberate stop without claiming repair has started:

```bash
aor review decide \
  --project-ref <repo> \
  --run-id <run_id> \
  --decision hold \
  --reason "Waiting for product-owner confirmation."
```

Use `request-repair` when review, QA, Runtime Harness, or post-run
verification findings must be repaired before delivery. Internal rehearsal runners pass
structured context with the operator-readable reason:

```bash
aor review decide \
  --project-ref <repo> \
  --run-id <run_id> \
  --decision request-repair \
  --repair-context-file <repair-context.json> \
  --reason "Feature-size-fit and Runtime Harness findings require repair."
```

The repair context records `source_phase`, `cycle_iteration`,
`unresolved_findings`, structured `unresolved_finding_details`,
`meaningful_changed_paths`, `verification_status`, `verification_refs`,
`previous_repair_decision_refs`, `context_fingerprint`,
`new_context_since_previous`, `stop_reason`, and `requested_next_step=execution`.
Each structured finding detail must include stable identity, category, severity,
summary, evidence refs, and a concrete resolution requirement that the next
execution can prove closed. If a later repair decision references previous
repair decisions, `new_context_since_previous` must explain the new finding,
changed path, verification status, or evidence ref that makes another public
repair actionable. The runner must create this decision through the public
CLI/API lifecycle; it must not mutate the target checkout directly.

Do not use `request-repair` for a verification-mapping-only review warning when
primary verification passed and review has no actionable implementation finding.
In that case the operator should preserve the warning as review evidence, let QA
and delivery gates inspect the linked verification summary, and avoid creating a
repair request that would only repeat the same context.
The same applies to `baseline_failure_status=pre_existing` and
`verification_failure_baseline_matches[]`: those refs prove a known broken
baseline, not a new implementation defect.

## Delivery and release gate
Delivery and release can require an explicit approval decision:

```bash
aor deliver prepare \
  --project-ref <repo> \
  --run-id <run_id> \
  --mode patch-only \
  --approved-handoff-ref <ref> \
  --promotion-evidence-refs <ref[,ref...]> \
  --require-review-decision
```

```bash
aor release prepare \
  --project-ref <repo> \
  --run-id <run_id> \
  --mode patch-only \
  --approved-handoff-ref <ref> \
  --promotion-evidence-refs <ref[,ref...]> \
  --require-review-decision
```

When the gate is required:
- missing `review-decision` blocks delivery/release;
- `hold` blocks delivery/release;
- `request-repair` blocks delivery/release;
- `approve` passes only when the decision artifact itself records a passing delivery gate.
- repeated repair context without new evidence blocks the implementation cycle
  before delivery/release gates are reached.

## Evidence to inspect
- `aor evidence show --project-ref <repo> --run-id <run_id>` lists run-linked `review-report`, `review-decision`, Runtime Harness, learning-loop, incident, and delivery evidence.
- `aor audit runs --project-ref <repo> --run-id <run_id>` keeps the run-centric evidence refs visible for operators and auditors.

## Boundary rules
- Do not use `review decide` to bypass deterministic validation, evaluation, or Runtime Harness failures.
- Do not edit prior decision artifacts to change approval state. Create a later decision artifact instead.
- Do not enable upstream write-back solely from a review decision. Delivery policy, handoff approval, promotion evidence, route governance, and write-back mode still apply.
