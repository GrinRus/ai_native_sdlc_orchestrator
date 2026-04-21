# Runbook: live E2E standard runner

## Purpose
Provide one standard start/observe/abort flow for the catalog-backed live E2E profiles.

## Profile mapping
Use only the canonical profiles from `examples/live-e2e/`:
- `regress-short.yaml` for the `sindresorhus/ky` fast regression scenario.
- `regress-long.yaml` for the `httpie/cli` deeper regression scenario.
- `release-short.yaml` for the `sindresorhus/ky` short release-shaped rehearsal.
- `release-long.yaml` for the `belgattitude/nextjs-monorepo-example` long release-shaped rehearsal.

This mapping stays aligned with `docs/ops/live-e2e-target-catalog.md`.

## Start
```bash
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/regress-short.yaml
```

Optional bounded hold-open mode for abort rehearsals:
```bash
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/regress-short.yaml \
  --hold-open true
```

Expected output includes:
- `live_e2e_run_id`
- `live_e2e_run_summary_file`
- `live_e2e_scorecard_files`

The run summary also carries learning-loop linkage fields:
- `learning_loop_scorecard_file`
- `learning_loop_handoff_file`
- `incident_report_file` (for failed or aborted runs)

## Observe
```bash
aor live-e2e status \
  --project-ref . \
  --run-id <RUN_ID>
```

Detailed report:
```bash
aor live-e2e report \
  --project-ref . \
  --run-id <RUN_ID>
```

## Abort
Abort only when run status is non-terminal:
```bash
aor live-e2e status \
  --project-ref . \
  --run-id <RUN_ID> \
  --abort true \
  --reason "operator stop due to budget or external gate"
```

Expected abort behavior:
- updates the durable run summary status to `aborted`;
- emits terminal stream event for the same run id;
- keeps already materialized evidence and scorecards intact.

## Operator checks
- Run summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `aor run status --run-id <RUN_ID> --follow true` can observe the same run stream.
- CLI-only operation remains valid with web UI detached.
- Use `live-e2e-learning-loop.md` to hand off incidents and scorecards into backlog and quality follow-up.
