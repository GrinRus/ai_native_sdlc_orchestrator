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
- `read_only`

Each route row carries `step`, `route_id`, runner/adapter, provider,
`requested_model`, `effective_model`, `model_source`, required capabilities,
fallback summary, `mode` (`simulation` or `live`), qualification, readiness,
and `approved_routes[]`. Each approved route option contains only a canonical
route ID and bounded display metadata from the route registry; clients must
submit that ID rather than provider/model strings. Machine paths and credential
values are not part of this contract. `latest_readiness_ref` may link the latest
durable check without embedding local secrets.

For an unconfigured project, reads return `initialized: false` and `routes: []`
without creating a project profile or runtime state.
