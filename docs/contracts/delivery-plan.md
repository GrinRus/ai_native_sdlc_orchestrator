# Delivery plan

## Purpose
Durable pre-write artifact that makes delivery intent explicit before any write-back path starts.

## Required fields
- `plan_id`
- `project_id`
- `run_id`
- `step_class`
- `delivery_mode`
- `mode_source`
- `preconditions`
- `writeback_allowed`
- `blocking_reasons[]`
- `status`
- `evidence_refs[]`
- `created_at`

## Delivery mode values
- `no-write` — read-only/rehearsal-only execution with no write-back.
- `patch-only` — produce patch output only.
- `local-branch` — write changes to a local branch in an isolated checkout.
- `fork-first-pr` — plan fork-first branch + pull request style delivery.

## Policy notes
- Delivery mode must be explicit and machine-checkable before write-back starts.
- Non-read-only modes (`patch-only`, `local-branch`, `fork-first-pr`) must require:
  - approved handoff evidence;
  - promotion evidence.
- `status=blocked` means write-back is not allowed for the planned mode yet.
- `governance` should expose route-governance decision semantics (`allow|deny|escalate`) with explicit reason codes for security/compliance review.
- `coordination` should preserve repo-level coordination requirements:
  - `required` and `status` for multi-repo gating;
  - `repo_ids[]` and `repos[]` to keep repo scope explicit;
  - `evidence_refs[]` for approved cross-repo coordination artifacts.
- `rerun_recovery` should preserve bounded retry semantics:
  - `rerun_of_run_ref`, `failed_step_ref`, and `packet_boundary`;
  - `status` (`not-requested|ready|blocked`) and `blocking_reasons[]`;
  - `strategy` (`resume-failed-step|rebuild-release-packet`).

## Example
See `examples/packets/delivery-plan-*.yaml`.
