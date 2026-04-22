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

`evidence_summary` should name the exact eval and harness artifacts used in the decision.

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
