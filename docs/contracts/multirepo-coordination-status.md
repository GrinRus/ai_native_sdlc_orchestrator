# Multirepo coordination status

`multirepo-coordination-status` is the durable evidence record for bounded multirepo scoped locks and cross-repo validation. It does not replace Git provider permissions or repository branch protection; it records AOR's local coordination precondition before delivery uses a multi-repo write-back path.

## Required fields

- `status_id` — stable report id for this coordination snapshot.
- `project_id` — owning project profile id.
- `run_id` — run or delivery-preparation id that requested the coordination state.
- `version` — contract version.
- `generated_from` — command/API surface and operator input metadata.
- `lock_scope` — requested bounded repo/path scope:
  - `repo_ids[]` — scoped repository ids from the project profile.
  - `path_globs[]` — path globs covered by the lock.
  - `owner_ref` — operator, agent, or service owner that requested the lock.
  - `duration_minutes` — requested lock duration.
- `lock_state` — active, released, conflict, stale, or inspection-only lock result:
  - `status` — `active`, `released`, `conflict`, `stale`, or `inspected`.
  - `lock_id` — created or inspected lock id when available.
  - `owner_ref`, `run_id`, `acquired_at`, `expires_at`, and `released_at` where applicable.
  - `conflicts[]` — deterministic conflict/stale lock records with lock id, owner, run, repo ids, path globs, and reason.
  - `release_evidence_refs[]` — release evidence refs when a lock was released.
- `cross_repo_validation` — per-repo and integration validation status:
  - `status` — `pass`, `partial`, `fail`, or `not-required`.
  - `repos[]` — one entry per scoped repo with `repo_id`, `status`, and `validation_refs[]`.
  - `missing_repo_ids[]` and `failed_repo_ids[]` — deterministic blocking sets.
  - `integration_validation_refs[]` — cross-repo or integration checks used as evidence.
- `delivery_evidence` — evidence refs to pass into delivery/release preparation:
  - `coordination_evidence_refs[]` — all refs that prove coordination.
  - `lock_evidence_refs[]` — lock-specific evidence refs.
  - `cross_repo_validation_refs[]` — validation-specific evidence refs.
- `status` — `ready`, `blocked`, or `released`.
- `blocking_reasons[]` — deterministic blocker codes such as `lock-conflict`, `lock-stale`, `cross-repo-validation-missing`, and `cross-repo-validation-failed`.
- `evidence_refs[]` — all source evidence refs used to build the status.
- `created_at` — ISO timestamp.

## Semantics

- Lock scope is bounded by the project-profile repo ids and path globs. Organization-wide or provider-global locks are out of scope.
- Active overlapping locks from a different owner/run block acquisition with `lock-conflict`.
- Expired overlapping locks block acquisition with `lock-stale` until an operator releases or replaces the stale state explicitly.
- Missing repo validation refs produce `cross-repo-validation-missing`.
- Failed repo validation refs produce `cross-repo-validation-failed`.
- `delivery_evidence` is designed to be copied into `delivery-plan.coordination` and then preserved in `delivery-manifest` and `release-packet` lineage.

## Safety

No lock state grants permission to write upstream repositories. Public-repo safety still defaults to no-write or fork-first delivery unless the delivery policy, approvals, promotion evidence, and provider credentials explicitly allow a network write.
