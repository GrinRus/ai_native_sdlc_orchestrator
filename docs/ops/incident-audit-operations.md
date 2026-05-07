# Runbook: incident and audit command operations

## Scope
Use this runbook when a run needs a durable incident record, a reviewed dataset backfill proposal, run-centric audit snapshots, or finance/production monitoring reads.

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
- `incident_report_file` exists under `.aor/projects/<project_id>/reports/incident-report-*.json`.
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
- each record includes `incident_ref`, `incident_report_file`, `linked_run_refs`, `linked_asset_refs`, and any `backfill_proposal_refs`.

## Propose dataset backfill
```bash
aor incident backfill \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID> \
  --suite-ref suite.regress.short@v1
```

Expected signals:
- `incident_backfill_proposal_file` exists under `.aor/projects/<project_id>/reports/incident-backfill-proposal-*.json`.
- `incident_backfill_proposal_state` is `proposed` unless an explicit reviewed state was supplied.
- `incident_backfill_suite_ref` and `incident_backfill_dataset_ref` identify the intended quality assets.
- `incident_backfill_review_required` is `true`.
- stable dataset files are not changed by this command; reviewers must approve the proposal before a separate dataset update is authored.

Blocked proposal creation:
- missing `incident_id` fails with an explicit not-found error;
- missing linked incident asset refs fails because the proposal would not be traceable;
- missing `suite_ref` or its target `dataset_ref` fails before any proposal is written.

## Recertify and re-enable
```bash
# mark incident for recertification
aor incident recertify \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID> \
  --decision recertify \
  --reason "waiting for certification evidence"

# hold transition when evidence is incomplete
aor incident recertify \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID> \
  --decision hold \
  --reason "promotion evidence still blocked"

# verified re-enable with explicit promotion decision evidence
aor incident recertify \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID> \
  --decision re-enable \
  --promotion-ref <PROMOTION_DECISION_REF>

# rollback-safe hold when platform rollout action is freeze/demote
aor incident recertify \
  --project-ref <PROJECT_ROOT> \
  --incident-id <INCIDENT_ID> \
  --decision re-enable \
  --promotion-ref <PROMOTION_DECISION_WITH_FREEZE_OR_DEMOTE_ACTION_REF>
```

Expected signals:
- `incident_status` transitions to `recertify`, `hold`, or `re-enabled`.
- output includes `incident_recertification_from_status`, `incident_recertification_to_status`, and gate result.
- re-enable fails with an explicit blocked error when promotion evidence is missing or non-pass.
- rollback-safe transitions emit:
  - `incident_recertification_platform_action`
  - `incident_recertification_platform_linkage` (`linked|rollback|unlinked`)
  - `incident_recertification_rollback_required`
  - `incident_recertification_finance_evidence_refs` and `incident_recertification_quality_evidence_refs`
  - `incident_recertification_finance_evidence_root` and `incident_recertification_quality_evidence_root`
- if platform action is `freeze` or `demote`, gate becomes `rollback` and resulting `incident_status` is `hold`.

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
- `run_audit_records` includes packet/step/quality refs and `finance_evidence` summaries.
- `finance_evidence` carries route/wrapper/adapter IDs plus cost, timeout, and latency rollups.
- `incident_refs` and `promotion_refs` highlight escalation and promotion lineage.
- `audit_evidence_refs` provides the aggregate evidence set for handoff.

## Finance monitoring
```bash
aor finance monitor \
  --project-ref <PROJECT_ROOT>
```

Expected signals:
- `finance_monitoring_snapshot.status` is `no-data`, `partial`, or `ready`.
- `finance_monitoring_snapshot.telemetry_state` is `no-data`, `partial-data`, or `ready`.
- `finance_analytics.dimensions` groups cost and latency by project, route, prompt/context bundle, compiler revision, and adapter.
- `production_monitoring` is populated only from explicitly scoped production monitoring live events.
- offline certification and rehearsal evidence remain separate under `monitoring_loop.evidence_classes`.

Boundary rules:
- missing cost, latency, dimension, or production monitoring evidence must remain visible as partial data;
- offline `promotion-decision`, `evaluation-report`, and `runtime-harness-report` artifacts do not prove production monitoring on their own;
- project-level grouping is a tenant-like reporting boundary for installed users, not hosted SaaS tenancy.

## Invalid lookup behavior
- `incident show --incident-id <missing>` must fail with an explicit not-found error.
- `incident backfill --incident-id <missing>` must fail with an explicit not-found error.
- `audit runs --run-id <missing>` must fail with an explicit not-found error.
