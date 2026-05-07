# Multirepo and governance

## Scope
AOR supports:
- single-repo projects,
- monorepos with multiple apps/packages/services,
- bounded multirepo topologies with explicit dependency edges.

Bounded multirepo topology is modeled inside one AOR project profile. A flow may coordinate explicit backend, mobile, frontend, documentation, or shared-library repositories, but MVP does not coordinate multiple independent AOR `project_id` profiles as one portfolio transaction.

## Required capabilities
- repo graph in the project profile;
- explicit impacted repo list in handoff and delivery artifacts;
- scoped locks so parallel runs do not collide;
- per-repo validation plus integration-level validation;
- coordinated delivery manifests for bounded cross-repo changes.

## Proof path
Single-repo, monorepo, and bounded multirepo targets all enter through the `project-profile` contract family. A bounded multirepo profile declares every participating repo in `repos[]` and dependency edges in `repo_graph[]`; it does not create child `project_id` profiles.

`project analyze` materializes `repo_scope_proof` with:
- declared topology and repo ids;
- repo graph edges;
- impacted repo scope derived from the profile;
- per-repo validation evidence refs;
- integration validation refs for graph edges;
- whether delivery coordination is required.

`project validate` repeats the same proof as the `repo-scope-proof` validator. Before coordinated delivery, `aor multirepo lock` writes `multirepo-coordination-status` evidence for scoped lock acquisition, release, stale/conflict blockers, and cross-repo validation completeness. Non-`no-write` delivery plans with more than one coordinated repo stay blocked until coordination evidence refs are present. Delivery manifests then preserve one `repo_deliveries[]` entry per coordinated repo, and release packets keep `evidence_lineage.coordination_refs`, `coordination_lock_refs`, and `cross_repo_validation_refs` for audit replay.

## Governance rules
- keep multirepo scope explicit;
- avoid unbounded organization-wide orchestration in MVP;
- record ownership and dependency edges;
- require stronger approvals for higher-risk cross-repo work.
- treat AOR locks as local coordination evidence only; repository permissions and public-repo no-write defaults still control write-back.
