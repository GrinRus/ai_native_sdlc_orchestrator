# Runbook: GitHub fork-first delivery baseline

## Purpose
Define safe default behavior for public-repository networked delivery planning before any real push or PR creation.

## Policy boundary
- Public repositories default to `fork-first-pr`.
- Direct upstream branch write is not allowed by default.
- This baseline materializes PR-ready metadata and API intent in `stubbed` mode only.

## Credential expectations
- Use credentials that can read upstream repository metadata.
- Fork owner credentials must be able to:
  - create or access the fork repository;
  - create branch refs in the fork;
  - open draft pull requests against upstream base branch.

## Permission checklist
Before switching from stubbed planning to real network write:
1. Confirm token has `repo` scope for private targets, or equivalent minimum scope for public targets.
2. Confirm fork owner can push branch refs to the fork repository.
3. Confirm upstream repository allows PRs from fork branches.
4. Confirm branch naming policy and PR draft policy are approved for the wave.

## Approval checkpoints
1. Approved handoff packet is present.
2. Promotion evidence is present for the impacted assets.
3. Delivery plan status is `ready`.
4. Security/compliance reviewer signs off when policy requires it.

## Human checkpoints before production write-back
1. Confirm latest `delivery-manifest-*.json` captures:
   - `delivery_mode`,
   - `repo_deliveries[].changed_paths`,
   - `approval_context`,
   - `source_refs.delivery_transcript_ref`.
2. Confirm latest `release-packet-*.json` captures:
   - `delivery_manifest_ref`,
   - `evidence_lineage.handoff_refs`,
   - `evidence_lineage.promotion_refs`,
   - `evidence_lineage.execution_refs`.
3. If any checkpoint is missing, stop and rerun rehearsal in no-write mode.
4. Only after all checkpoints pass may operators request policy change for real network write-back.

## Recovery checkpoints
On delivery failure:
1. Inspect the latest delivery transcript `error` and `recovery_steps`.
2. Confirm release packet status is `blocked`.
3. Restore repository state according to transcript guidance.
4. Re-run no-write rehearsal before any policy change request.

## Evidence outputs (W4-S04)
- Fork target metadata (`upstream_repo`, `fork_repo`)
- Branch ref metadata (`base_ref`, `head_ref`, `head_branch`)
- Draft PR metadata (`title`, `body`, `is_draft`, base/head refs)
- API intent evidence (`fork_request`, `push_request`, `pr_request`)

Fixture sample:
- `examples/live-e2e/fixtures/w4-s04/fork-first-intent.sample.json`
- `examples/live-e2e/fixtures/w4-s06/public-target-delivery-rehearsal.sample.md`
