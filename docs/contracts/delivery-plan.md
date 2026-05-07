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
- Non-`no-write` modes (`patch-only`, `local-branch`, `fork-first-pr`) must require:
  - approved handoff evidence;
  - promotion evidence.
- Strict non-`no-write` delivery/release preparation must also require `preconditions.runtime_harness`:
  - `required=true`;
  - `enforced=true` for strict gates and `enforced=false` only for observe-mode diagnostics;
  - `status=pass` before write-back can start;
  - `report_ref` pointing to the latest run-level Runtime Harness report for the same `run_id`;
  - `overall_decision=pass`, `run_decision=pass`, non-empty `mission_scoped_changed_paths[]`, and empty `scope_violation_paths[]`.
- `status=blocked` means write-back is not allowed for the planned mode yet.
- `governance` should expose route-governance decision semantics (`allow|deny|escalate`) with explicit reason codes for security/compliance review.
- `coordination` should preserve repo-level coordination requirements:
  - `required` and `status` for multi-repo gating;
  - `repo_ids[]` and `repos[]` to keep repo scope explicit;
  - `evidence_refs[]` for approved cross-repo coordination artifacts;
  - `lock_evidence_refs[]` for scoped multirepo lock status evidence;
  - `cross_repo_validation_refs[]` for per-repo and integration validation evidence.
- For bounded multirepo non-`no-write` delivery, `coordination.evidence_refs[]` remains the guardrail field that unblocks write-back. `lock_evidence_refs[]` and `cross_repo_validation_refs[]` are narrower lineage fields that make the lock and validation chain auditable in the downstream manifest and release packet.
- `rerun_recovery` should preserve bounded retry semantics:
  - `rerun_of_run_ref`, `failed_step_ref`, and `packet_boundary`;
  - `status` (`not-requested|ready|blocked`) and `blocking_reasons[]`;
  - `strategy` (`resume-failed-step|rebuild-release-packet`).
- `runtime-harness-gate-required` is the canonical blocking reason when strict delivery has not been backed by pass-level Runtime Harness evidence.

## Example
See `examples/packets/delivery-plan-*.yaml`.
