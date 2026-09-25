# Execution profile

`execution-profile` is a derived, read-only projection of the portable
`project-profile.default_route_profiles` selection and the approved route,
adapter, provider, model, capability, fallback, and readiness metadata that
will govern execution.

It is not an independent configuration store. Route selection mutations update
the versioned project profile; the projection is rebuilt from that profile and
the canonical route and adapter registries.

Required top-level fields:

- `profile_id`, `project_id`, `revision`
- `initialized`
- `routes[]`
- `preparation_runners[]`
- `read_only`

Each route row carries `step`, `route_id`, runner/adapter, provider,
`requested_model`, `effective_model`, `model_source`, optional
`requested_reasoning_effort`, `effective_reasoning_effort`, and
`reasoning_effort_source`, required capabilities,
fallback summary, `mode` (`simulation` or `live`), qualification, readiness,
and `approved_routes[]`. Each approved route option contains only a canonical
route ID and bounded display metadata from the route registry; clients must
submit that ID rather than provider/model strings. Approved route options also
report exact-route readiness after a route check, allowing a task override to
be checked without changing the project default. Machine paths and credential
values are not part of this contract. `latest_readiness_ref` may link the latest
durable check without embedding local secrets.

For an unconfigured project, reads return `initialized: false`, `routes: []`,
and `preparation_runners: []` without creating a project profile or runtime
state. An explicit `initialize` action creates the default runtime profile
under AOR Home; it never writes configuration into the connected repository.
The read-only `preparation_runners[]` options list approved
`route.intake-normalize.*` routes and their credential-free readiness summaries.
Checking one option accepts its `step` and `route_id`; this does not change the
project's execution route. The Prepared Task screen also checks the selected
execution route after a route change, so clearing stale readiness has a direct
recovery path. Readiness checks record local runner/auth/model status and do
not start a provider.

`POST /api/projects/:projectId/execution-profile/actions` supports `initialize`,
`select`, `reset`, and `check`. The first action is an explicit initialization
of runtime/profile state. The readiness check can name one approved route and
step; it records readiness metadata without starting a provider process.
