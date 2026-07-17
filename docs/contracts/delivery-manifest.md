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

Newly materialized manifests use `schema_version: 2` and add
`coordination_transaction`. Legacy manifests without a version remain readable.
The transaction records aggregate `complete|partial|blocked` status, exact repo
membership, completed/failed repo ids, integration and lock evidence, and
rollback refs. Each repository records its transaction stage, failed step,
rollback refs, and catalog-owned recovery action. Partial write effects are
never represented as aggregate success.

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
For non-`no-write` delivery, the final delivered changed-path set must include every `approval_context.runtime_harness.meaningful_changed_paths[]` entry. If a meaningful path observed by Runtime Harness is missing from the final patch, branch commit, or fork PR diff, delivery must fail with recovery guidance instead of submitting a partial manifest.
`coordination` should capture multi-repo coordination requirement/status and evidence refs used to unblock write-back. When `multirepo-coordination-status` evidence exists, the manifest should also preserve `lock_evidence_refs[]` and `cross_repo_validation_refs[]` both at top-level coordination and each repo delivery coordination record.
`rerun_recovery` should keep retry scope bounded by one failed step and explicit packet boundary.
When fork-first network write is executed, `repo_deliveries[].pr_draft` and `writeback_policy.network_mode` should preserve draft PR and network provenance for audit replay.

## Example
See `examples/delivery-manifest.sample.yaml`.
