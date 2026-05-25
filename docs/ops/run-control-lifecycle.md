# Run-control lifecycle

Use these commands to control one run with explicit policy and audit semantics.

## Start
```bash
aor run start --project-ref <AOR_WORKSPACE> --run-id <RUN_ID>
```
Expected output fields:
- `run_control_action: "start"`
- `run_control_blocked: false`
- `run_control_state.status: "running"`
- `run_control_audit_file` and `run_control_state_file` paths

## Pause and resume
```bash
aor run pause --project-ref <AOR_WORKSPACE> --run-id <RUN_ID>
aor run resume --project-ref <AOR_WORKSPACE> --run-id <RUN_ID>
```
Expected behavior:
- pause only from `running`;
- resume only from `paused`;
- invalid transitions return `run_control_blocked: true` and still write `run_control_audit_file`.

## Steer with explicit scope
```bash
aor run steer \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --target-step <STEP_CLASS> \
  --approval-ref <APPROVAL_REF>
```
Guardrail behavior:
- missing `--target-step` blocks operation as out-of-scope;
- high-risk steer may require `--approval-ref` by policy.

`run steer` remains a run-control transition. Do not put free-form work
instructions into `run steer`; use `aor request create` and `aor request run`
when the operator wants AOR to analyze, explain, repair, revise, validate,
plan, implement, or review bounded artifacts through the runtime.

## Operator-initiated runtime work
```bash
aor request create \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --stage execution \
  --intent repair \
  --request "Analyze the failed run evidence and propose a safe repair." \
  --target-ref evidence://.aor/projects/<PROJECT_ID>/reports/step-result-<RUN_ID>.json \
  --delivery-mode no-write \
  --json

aor request run \
  --project-ref <AOR_WORKSPACE> \
  --runtime-root <AOR_WORKSPACE>/.aor \
  --request-ref <OPERATOR_REQUEST_REF> \
  --target-step repair \
  --json
```

Expected output fields:
- `operator_request_ref`
- `operator_request_run.run_id`
- `routed_step_result_file`
- `compiled_context_ref`
- `proposal_refs`
- `patch_refs`
- `next_action_report_file`

Safety behavior:
- `delivery-mode` defaults to `no-write`;
- `patch-only`, `local-branch`, and `fork-first-pr` require explicit
  `--allowed-path` scope;
- raw request text is stored only in the durable `operator-request` artifact;
- status, list, API, and web read surfaces show sanitized summaries and refs.

## Cancel
```bash
aor run cancel \
  --project-ref <AOR_WORKSPACE> \
  --run-id <RUN_ID> \
  --approval-ref <APPROVAL_REF>
```
Expected behavior:
- cancel only from `running` or `paused`;
- successful cancel ends in `run_control_state.status: "canceled"`;
- terminal transition emits `run.terminal` plus durable audit evidence.

## Follow and audit
```bash
aor run status --project-ref <AOR_WORKSPACE> --run-id <RUN_ID> --follow true
```
Check:
- `run_control_audit_file` exists for every control command invocation;
- live stream includes control events plus `evidence.linked` entries with audit/state references.
