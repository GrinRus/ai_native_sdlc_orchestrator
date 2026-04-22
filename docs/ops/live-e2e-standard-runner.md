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
Canonical dependency requirements are tracked in `docs/ops/live-e2e-dependency-matrix.md`.

## Start
```bash
aor live-e2e start \
  --project-ref . \
  --profile ./examples/live-e2e/regress-short.yaml
```

`--project-ref` is the AOR control-plane workspace used for runtime state under `.aor/`.
The rehearsal `target_repo` is loaded from the selected live E2E profile and cloned by the runner automatically into:
- `.aor/projects/<project_id>/workspaces/live-e2e/<run_id>/target`

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

## Setup and verification command artifacts
For canonical `setup_commands` and verification command dependencies by profile, see `docs/ops/live-e2e-dependency-matrix.md`.

When `verification.setup_commands` are present, the runner executes them first in the cloned target workspace.
When `verification.commands` are present, the runner executes them sequentially after setup commands.

The run summary/report emits:
- `artifacts.verification_setup_command_reports[]` for setup commands;
- `artifacts.verification_command_reports[]` for verification commands;
- per-command `stdout` and `stderr` logs under `.aor/projects/<project_id>/reports/`;
- `exit_code`, `duration_ms`, and `cwd` metadata for each command.

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
