# Planner metrics snapshot

## Purpose
Query-time planner visibility projection for decomposition quality and scheduler health.

This read model exposes the same metric names across CLI, API, and web surfaces while keeping the source of truth in durable runtime artifacts. It is a snapshot, not a scheduling mutation or production SLO dashboard.

## Required fields
- `schema_version`
- `snapshot_id`
- `project_id`
- `generated_at`
- `status`
- `no_data`
- `metric_names`
- `aggregation`
- `source_artifacts`
- `metrics`
- `run_breakdown`

## Metric vocabulary
`metric_names` must contain:
- `clean_close_rate`
- `retry_rate`
- `repair_rate`
- `blocker_rate`

Each metric under `metrics` should carry:
- `name`
- `unit` (`ratio`)
- `numerator`
- `denominator`
- `value`
- `no_data`
- `evidence_run_ids`

When no durable run history exists, `value` must be `null` and `no_data=true`; implementations must not report misleading `0` success or failure rates.

## Source artifacts
The projection is derived from durable evidence only:
- run summaries and run-linked packets/reports;
- `review-report` and `review-decision` artifacts;
- `runtime-harness-report` decisions and repair attempt ledgers;
- `incident-report` status;
- run-control audit records (`run-control-event-*.json`) and live event lineage.

## Aggregation semantics
- Denominator: unique run ids with any durable run, review, incident, or audit evidence.
- `clean_close_rate`: runs with pass review evidence and pass Runtime Harness evidence, with no retry, repair, or blocker signal.
- `retry_rate`: runs with Runtime Harness retry decisions or retry attempt ledger entries.
- `repair_rate`: runs with Runtime Harness repair decisions, repair attempt ledger entries, or `request-repair` review decisions.
- `blocker_rate`: runs with open incident evidence, blocked run-control audit records, blocking Runtime Harness decisions, or hold/request-repair review decisions.

`run_breakdown[]` should expose each run's classification, metric signals, and evidence refs so planner dashboards can explain the rate without raw artifact inspection.

## Boundary rules
- The snapshot is read-only and must not change run-control scheduling state.
- The web UI may render this projection, but CLI/API read surfaces remain authoritative and headless-safe.
- Production SLO dashboards, tenant billing analytics, and scheduler policy changes are out of scope for this contract.
