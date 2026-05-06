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

Use `request-repair` when review or Runtime Harness findings must be repaired before delivery:

```bash
aor review decide \
  --project-ref <repo> \
  --run-id <run_id> \
  --decision request-repair \
  --reason "Feature-size-fit and Runtime Harness findings require repair."
```

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

## Evidence to inspect
- `aor evidence show --project-ref <repo> --run-id <run_id>` lists run-linked `review-report`, `review-decision`, Runtime Harness, learning-loop, incident, and delivery evidence.
- `aor audit runs --project-ref <repo> --run-id <run_id>` keeps the run-centric evidence refs visible for operators and auditors.

## Boundary rules
- Do not use `review decide` to bypass deterministic validation, evaluation, or Runtime Harness failures.
- Do not edit prior decision artifacts to change approval state. Create a later decision artifact instead.
- Do not enable upstream write-back solely from a review decision. Delivery policy, handoff approval, promotion evidence, route governance, and write-back mode still apply.
