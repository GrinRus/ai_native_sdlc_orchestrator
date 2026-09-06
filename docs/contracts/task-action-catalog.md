# Task action catalog

The Task Workspace mutation route is driven by one server-owned catalog at
`packages/orchestrator-core/src/control-plane/task-action-catalog.mjs`.
Transports and clients must treat `action_id` as an opaque typed identifier and
must not maintain their own lifecycle allowlist or infer mutations from a shell
command.

Each catalog entry publishes:

- `category`: `mutation`, `workbench`, `evidence`, or `refresh`;
- `permission`: `mutate` for state-changing actions, otherwise `read`;
- `dispatch`: the server-owned mutation/readback boundary;
- `payload`: field names, scalar types, and requiredness;
- `requires_confirmation` and, for lifecycle actions, the canonical command.

The public Task action request always contains `action`. CAS-protected actions
carry the displayed non-negative `expected_revision`. Successful mutations
return a `readback` object containing the refreshed Task projection, stable
intent/Mission/Flow/run lineage, current state and revision, and evidence refs.
Blocked actions return the same typed error envelope and a catalog recovery
action; they never claim Active or Completed without durable server evidence.

The catalog currently covers intent start/confirmation, run control, durable
operator requests, follow-up creation, discovery/specification/planning,
approval, review, delivery, release, learning, repair, inspection, and
completion paths. New primary actions must be added here first, then covered by
catalog parity tests and the S14 UI wiring handoff.
