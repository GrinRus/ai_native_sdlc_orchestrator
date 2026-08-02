# Execution readiness report

`execution-readiness-report` is the durable result of an explicit route
readiness check. It proves that route, adapter, runner, auth summary, model,
capability, and policy prerequisites were checked before provider spawn.

Allowed readiness states are `unconfigured`, `runner-missing`, `auth-missing`,
`model-unsupported`, `capability-mismatch`, `policy-denied`, `ready`, and
`stale`.

Required fields:

- `report_id`, `project_id`, `revision`
- `status`, `checked_at`
- `step_results[]`
- `evidence_refs[]`

Runner and authentication facts are summaries only (`runner_available`,
`auth_ready`, timestamps, and diagnostic codes). Credential values, tokens,
environment contents, and provider output are forbidden. A stale project
profile revision makes a previous report `stale`.
