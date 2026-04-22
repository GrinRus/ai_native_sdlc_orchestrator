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
