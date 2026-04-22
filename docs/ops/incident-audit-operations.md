# Runbook: incident and audit command operations

## Scope
Use this runbook when a run needs a durable incident record or when operators need run-centric audit snapshots.

## Preconditions
- Runtime artifacts exist for the target run (`aor run status --run-id <RUN_ID>` returns at least one summary).
- Project runtime root is accessible.

## Open incident
```bash
aor incident open \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID> \
  --summary "<INCIDENT_SUMMARY>" \
  --severity critical \
  --linked-asset-refs evidence://external/manual-note
```

Expected signals:
- `incident_id` is returned.
- `incident_file` exists under `.aor/projects/<project_id>/reports/incident-report-*.json`.
- `incident_run_ref` matches `run://<RUN_ID>`.

## Show incidents
```bash
# by incident id
aor incident show \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID>

# by run id
aor incident show \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID>
```

Expected signals:
- `incident_records` is returned.
- each record includes `incident_ref`, `linked_run_refs`, and `linked_asset_refs`.

## Audit runs
```bash
# one run
aor audit runs \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID>

# bounded list
aor audit runs \
  --project-ref <PROJECT_ROOT> \
  --limit 20
```

Expected signals:
- `run_audit_records` includes packet/step/quality refs.
- `incident_refs` and `promotion_refs` highlight escalation and promotion lineage.
- `audit_evidence_refs` provides the aggregate evidence set for handoff.

## Invalid lookup behavior
- `incident show --incident-id <missing>` must fail with an explicit not-found error.
- `audit runs --run-id <missing>` must fail with an explicit not-found error.
