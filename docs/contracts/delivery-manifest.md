# Delivery manifest

## Purpose
Durable description of how execution became an actual patch, branch, fork PR, or controlled direct write.

## Required fields
- `manifest_id`
- `project_id`
- `ticket_id`
- `run_refs`
- `step_ref`
- `delivery_mode`
- `writeback_policy`
- `repo_deliveries[]`
- `verification_refs`
- `approval_context`
- `evidence_root`
- `source_refs`
- `status`
- `created_at`

## Notes
A delivery manifest is required whenever a flow reaches delivery or release.
Manifest materialization should happen only after a `delivery-plan` artifact is present with `status=ready`.
Delivery-capable runs should include execution isolation metadata (mode, checkout root, and cleanup policy/outcome) so write-back provenance is replayable.
`repo_deliveries[].changed_paths` is the canonical file-level delta list for the delivery run.
For bounded multirepo delivery, `repo_deliveries[]` should contain one entry per coordinated repo from the delivery plan. Each entry should preserve `repo_id`, repo role/source metadata when available, repo-local changed-path classification, write-back result, and coordination evidence refs.
For strict code-changing missions, an empty patch or empty non-bootstrap changed-path set is a machine-readable quality failure even when the manifest is structurally valid for audit lineage.
Strict delivery/release preparation must also fail before manifest materialization when the run has no Runtime Harness routed step decisions or the selected Runtime Harness report is not `pass`.
`approval_context` should preserve handoff, promotion, and Runtime Harness gate evidence references that justified write-back eligibility.
For strict non-`no-write` delivery, `approval_context.runtime_harness` should mirror the delivery plan precondition so downstream review can verify Runtime Harness pass decisions, routed decision count, meaningful implementation changed paths, and run-level controller evidence when present.
`coordination` should capture multi-repo coordination requirement/status and evidence refs used to unblock write-back. When `multirepo-coordination-status` evidence exists, the manifest should also preserve `lock_evidence_refs[]` and `cross_repo_validation_refs[]` both at top-level coordination and each repo delivery coordination record.
`rerun_recovery` should keep retry scope bounded by one failed step and explicit packet boundary.
When fork-first network write is executed, `repo_deliveries[].pr_draft` and `writeback_policy.network_mode` should preserve draft PR and network provenance for audit replay.

## Example
See `examples/delivery-manifest.sample.yaml`.
