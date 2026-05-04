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

## Governance rules
- keep multirepo scope explicit;
- avoid unbounded organization-wide orchestration in MVP;
- record ownership and dependency edges;
- require stronger approvals for higher-risk cross-repo work.
