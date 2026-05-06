# Runbook: operator strategic visibility snapshots

## Purpose
Provide sponsor/planner-friendly wave and risk snapshots through existing operator read surfaces without direct backlog-file inspection.

## CLI surface
```bash
aor run status \
  --project-ref .
```

Read `strategic_snapshot` from output:
- `wave_snapshot.state_totals` for global readiness/blocking posture.
- `wave_snapshot.waves[]` for per-wave completion ratios.
- `risk_snapshot.level_totals` and `risk_snapshot.high_risk_run_ids` for triage priority.
- `planner_metrics.metrics.clean_close_rate`, `retry_rate`, `repair_rate`, and `blocker_rate` for planner health.
- `planner_metrics.status=no-data` means no durable run, review, incident, or audit history exists yet; do not interpret this as a zero-risk or zero-success project.

## Web surface
Use the operator console (`apps/web`) and inspect the **Strategic Snapshot** panel.

## Interpretation guidance
- High-risk runs include incident-linked runs or baseline regression signals.
- Medium-risk runs indicate incomplete packet/quality lineage.
- Low-risk runs have sufficient packet + quality linkage and no high-risk signals.
- Clean-close requires pass review evidence plus pass Runtime Harness evidence with no retry, repair, blocker, or open-incident signal.
- Retry and repair rates come from Runtime Harness decisions and attempt ledgers; repair also includes explicit `request-repair` review decisions.
- Blocker rate comes from open incidents, blocked run-control audit records, hold/request-repair review decisions, and blocking Runtime Harness decisions.

## Limits
- Wave snapshot reads `docs/backlog/mvp-implementation-backlog.md`; if unavailable, wave totals return zero while risk snapshot remains available.
- Risk levels are deterministic heuristics from current runtime artifacts and should be paired with detailed run evidence review before policy decisions.
- Planner metrics are read projections for visibility only. They do not change scheduler behavior or replace production SLO dashboards.
