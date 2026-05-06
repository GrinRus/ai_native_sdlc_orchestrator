# Finance monitoring snapshot

## Purpose
Query-time finance analytics and production monitoring read model for installed, bounded runs.

This snapshot summarizes cost and latency signals by project, route, prompt/context bundle, compiler revision, and adapter while keeping production monitoring evidence separate from offline certification and rehearsal evidence. It is a read model, not a billing-provider integration, hosted tenant ledger, or certification pass/fail decision.

## Required fields
- `schema_version`
- `snapshot_id`
- `project_id`
- `generated_at`
- `status`
- `no_data`
- `telemetry_state`
- `dimension_names`
- `tenant_like_grouping`
- `aggregation`
- `finance`
- `monitoring_loop`
- `source_artifacts`
- `run_breakdown`

## Status values
`status` must be one of:
- `no-data`
- `partial`
- `ready`

`telemetry_state` must be one of:
- `no-data`
- `partial-data`
- `ready`

## Dimensions
`dimension_names` must contain:
- `project`
- `route`
- `bundle`
- `compiler_revision`
- `adapter`

`finance.dimensions` should expose the same dimension keys across CLI, API, and web surfaces. Bundle aggregation covers prompt and context bundle refs. Compiler revision aggregation uses canonical `compiler-revision://...` refs when available.

## Finance semantics
Cost signals currently use bounded policy maximums or provider-reported cost when durable evidence contains one. Until external billing integrations exist, implementations must not claim invoice-grade spend.

Latency signals are split into:
- `step_latency_sec`, derived from routed step execution timestamps;
- `certification_latency_sec`, derived from offline certification finance signals.

Missing telemetry must stay explicit:
- empty projects return `status=no-data`, `no_data=true`, and `telemetry_state=no-data`;
- runs with some finance evidence but missing dimensions, latency, cost, or production monitoring return `telemetry_state=partial-data`;
- implementations must not turn missing telemetry into zero cost or zero latency.

## Monitoring evidence classes
`monitoring_loop.evidence_classes` must keep these classes separate:
- `production_monitoring`
- `offline_certification`
- `rehearsal`

Production monitoring requires explicit event scope such as `production`, `production-monitoring`, or `production_monitoring`. Offline certification evidence may include `promotion-decision`, `evaluation-report`, and `runtime-harness-report` artifacts. Rehearsal evidence may include live E2E, proof-runner, or explicitly rehearsal-scoped events.

Production monitoring evidence must not be inferred from offline certification or rehearsal artifacts.

## Tenant-like grouping boundary
`tenant_like_grouping.grouping_key=project_id` provides project-level cost and latency grouping for installed users and bounded multirepo reporting. It is not a hosted SaaS tenancy or identity isolation claim.

## Example
See `examples/reports/finance-monitoring-snapshot.sample.yaml`.
