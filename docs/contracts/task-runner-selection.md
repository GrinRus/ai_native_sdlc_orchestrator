# Task runner selection

`task-runner-selection` is the read-only projection of the approved execution
route for a Task. `source` is `project-default` or `task-override`. A task
override selects an existing approved `route_id`; it does not create a new
execution owner or bypass route policy. Without an override, the Task follows
the project's selected route for its execution step.

The route is resolved from the execution profile for the Task's execution step.
The read-only `route.intake-normalize.*` used to prepare an intent is provenance
only and must never populate `route_id` here. Task overrides are stored with
the existing durable intent submission and follow its lineage after
confirmation. They do not modify the project's default route.

The projection carries readiness and requested/effective model and reasoning
effort metadata. Explicit values remain adapter-owned opaque strings; omitted
values use the runner-native default. Raw provider flags, credentials, auth
homes, and private paths are never returned.

`selection_revision` is a non-negative CAS value for runner selection changes.
The Task action `select-runner` writes a task override; `reset-runner` restores
the project default. Both also require the displayed normalization
`expected_revision`. A stale selection or normalization revision returns 409
without changing the submission. The exact selected route is checked again
before the task starts. The same selection is available headlessly through
`aor task start --route <route_id>`, which persists the override with the
submission and then applies the same exact-route readiness check. Omitting
`--route` uses the saved selection or project default; pass
`--use-project-default true` to clear a saved override. `selection_revision`
is optional only on legacy projections.

When readiness is not `ready`, `unavailable_reason` and a bounded
`recovery_action` explain how the operator can recover. Execution readiness
values are `ready`, `unknown`, `stale`, `unavailable`, `blocked`,
`unconfigured`, `runner-missing`, `auth-missing`, `model-unsupported`,
`capability-mismatch`, and `policy-denied`.
