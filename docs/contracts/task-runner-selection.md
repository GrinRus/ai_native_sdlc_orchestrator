# Task runner selection

`task-runner-selection` is a read-only projection of the approved execution
route chosen for a Task. `source` is `project-default` or `task-override`; a
task override selects an existing approved `route_id` (or reports `null` while
readiness is unknown) and does not create a new execution owner or bypass route
policy.

The route is resolved from the execution profile for the Task's execution step.
The read-only `route.intake-normalize.*` used to prepare an intent is provenance
only and must never populate `route_id` here.

The projection carries readiness and requested/effective model and reasoning
effort metadata. Explicit values remain adapter-owned opaque strings; omitted
values use the runner-native default. Raw provider flags, credentials, auth
homes, and private paths are never returned.

When readiness is not `ready`, `unavailable_reason` and a bounded
`recovery_action` explain how the operator can recover. Selection changes use
the existing intent/confirmation CAS boundary and are durable after reload.
