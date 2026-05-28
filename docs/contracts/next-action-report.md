# Next action report

## Purpose
Durable report emitted by `aor next`.
It resolves exactly one safe primary action for the current project state while preserving blockers, mission evidence, onboarding evidence, and write-back policy context.

## Required fields
- `report_id`
- `project_id`
- `version`
- `generated_from`
- `project_state`
- `mission_state`
- `closure_state`
- `primary_action`
- `blockers`
- `bounded_execution`
- `evidence_refs`
- `status`
- `created_at`

## Status
`status` is:
- `ready` when the primary action can be taken without first fixing blockers.
- `blocked` when the primary action is a repair or completion action required before the guided flow can continue.

## Primary action
`primary_action` contains:
- `action_id`
- `command`
- `reason`
- `low_level_command`
- `evidence_refs`

Only one primary action is allowed. Additional suggestions belong in guided UI copy or future reports, not this contract.

## Mission state and bounded execution
`mission_state` links the latest `intake-request` packet and body when present. It must preserve completeness status, missing fields, mission id, delivery mode, allowed paths, and forbidden paths.

`bounded_execution` makes the selected delivery mode explicit before any delivery-capable recommendation. Installed-user guided flows must keep `upstream_writes_default=false`; delivery-capable modes must require review before write-back.

## Closure state
`closure_state` is the durable final-stage model for review, delivery, release, and learning UX. It is always present, even before execution has started.

It contains:
- `run_id` for the run whose closure evidence is being resolved, or `null` before run evidence exists.
- `review` with `status`, review report ref, Runtime Harness report ref, review decision ref, current decision, delivery gate status, downstream block flag, and required evidence refs.
- `delivery` with `status`, delivery-plan ref, delivery-manifest ref, release-packet ref, release-packet status, write-back result, blocked reasons, and `requires_review_decision=true`.
- `learning` with `status`, scorecard ref, handoff ref, and linked evidence refs.
- `evidence_chain`, the combined review, quality, delivery, release, and learning refs that CLI/API/web surfaces must show consistently.

Review statuses are `not-started`, `missing`, `decision-required`, `approved`, `held`, `repair-requested`, or `blocked`.
Delivery statuses are `waiting-for-review`, `blocked-review-required`, `ready-to-prepare`, `delivery-plan-pending`, `delivery-plan-ready`, `delivery-prepared`, `blocked`, or `release-ready`.
Learning statuses are `waiting-for-release`, `ready-for-handoff`, or `handoff-complete`.

Risky delivery and release recommendations must use `--require-review-decision` and must not be selected while `review.status` is anything other than `approved`.

## Flow projection usage (W34-S01)

Flow-centric UI and control-plane reads consume `next-action-report` as input
evidence; this contract remains the owner of the single safe next action. A
flow projection may copy the latest report ref, selected stage, blockers,
evidence refs, closure state, and bounded execution/write-back policy, but it
must not invent a second next-action decision.

After `New Flow`, runtime must create fresh mission/intake evidence and then run
`next` so the new flow points at a new `next-action-report`. Completed source
flows keep their existing report and closure evidence as read-only history.
