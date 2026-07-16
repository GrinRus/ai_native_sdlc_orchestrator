# Structured task-plan lifecycle

## Create and inspect

```bash
aor plan create --project-ref <repo> --approved-artifact <intake-packet>
aor plan show --project-ref <repo>
```

Expected create output includes `planning_run_ref`, `plan_ref`,
`plan_validation_report_file`, and, after structural pass,
`plan_evaluation_report_file`. `plan_status=revision-required` is readable but
not approvable. Legacy `wave create` and `handoff prepare` only read this latest
valid plan and return `structured-plan-required` when it is absent.

## Request a revision

```bash
aor plan revise \
  --project-ref <repo> \
  --plan-ref <plan-ref> \
  --reason "Split the integration work and narrow its scope."
```

The command immediately changes the current plan to `revision-requested`,
invalidates linked handoff approval for new starts, writes an audited revision
request, and returns a new `planning_run_ref`. Create the revised candidate with
`aor plan create`, then inspect the version diff:

```bash
aor plan diff \
  --project-ref <repo> \
  --from-plan-ref <old-plan-ref> \
  --to-plan-ref <new-plan-ref>
```

## Approve and execute

```bash
aor plan approve \
  --project-ref <repo> \
  --plan-ref <exact-plan-ref> \
  --approval-ref <approval-ref>

aor plan status --project-ref <repo> --plan-ref <exact-plan-ref>

aor run start \
  --project-ref <repo> \
  --execution-plan-ref <execution-plan-ref> \
  --execution-unit-id <unit-id>
```

Approval is bound to the exact plan version and digest and materializes an
immutable execution plan. Retry the same execution unit to create another
attempt under the same task IDs. Adapter success advances a task only to
`verification-pending`; required verification, criteria, and evidence must be
present before progress becomes `complete`.

The W60 closure proof is reproducible with the public plan commands, flow-plan
HTTP routes, `pnpm test:web:browser`, and `pnpm slice:gate -- W60-S05`. It does
not exercise provider credentials, parallel scheduling, multirepo provisioning,
or upstream writes.

## Recovery

- `plan-incomplete`: inspect the validation report and request revision.
- `mission-split-required`: split an xlarge mission into smaller flows.
- `plan-stale`: reload the current flow and approve its exact latest plan.
- `plan-immutable`: do not edit an approved/superseded artifact; request a
  revision from an allowed current version.
- `semantic-plan-evaluation-blocking`: inspect the evaluation report and revise
  the plan. Semantic warnings are advisory unless project policy makes them
  blocking.
- `stale` task progress: rerun or replan from the invalidated task boundary;
  evidence transfers only when the task digest is unchanged.

Runtime artifacts remain under `.aor/` and must not be committed.
