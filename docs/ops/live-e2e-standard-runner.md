# Runbook: live E2E standard runner

## Purpose
Provide one standard internal black-box harness for the catalog-backed installed-user rehearsal profiles.

## Profile mapping
Use only the canonical internal profiles from `scripts/live-e2e/profiles/`:
- `regress-short.yaml` for the `sindresorhus/ky` fast regression scenario.
- `regress-long.yaml` for the `httpie/cli` deeper regression scenario.
- `release-short.yaml` for the `sindresorhus/ky` short release-shaped rehearsal.
- `release-long.yaml` for the `belgattitude/nextjs-monorepo-example` long release-shaped rehearsal.
- `w7-governance-integration.yaml` for integrated quality + incident + finance closure evidence in W7.

This mapping stays aligned with `docs/ops/live-e2e-target-catalog.md`.

## Start
```bash
node ./scripts/live-e2e/run-profile.mjs \
  --project-ref . \
  --profile ./scripts/live-e2e/profiles/regress-short.yaml
```

Expected output includes:
- `run_id`
- `live_e2e_run_summary_file`
- `live_e2e_scorecard_files`

The run summary now also includes target-workspace materialization fields:
- `target_checkout_root`
- `generated_project_profile_file`
- `routed_step_result_file`
- `compiled_context_ref`
- `adapter_raw_evidence_ref`

These fields point to the run-scoped cloned target checkout and the run-scoped generated project profile under runtime state roots.
`routed_step_result_file` links the routed live execution packet, `compiled_context_ref` links compiled-context lineage, and `adapter_raw_evidence_ref` links raw external-adapter evidence.

The run summary also carries learning-loop linkage fields:
- `learning_loop_scorecard_file`
- `learning_loop_handoff_file`
- `incident_report_file` (for failed runs or forced-incident profiles)

For profiles that set `learning_loop.force_incident=true`, `incident_report_file` is emitted even on `status=pass` so closure evidence stays linked.

## Inspect
The harness is a one-shot command. Inspect the emitted `live_e2e_run_summary_file` directly:
- read `status`, `stage_results`, and `command_results`;
- inspect `artifacts.routed_step_result_file`, `artifacts.verify_summary_file`, and delivery/release artifacts when present;
- use `learning_loop_scorecard_file` and `learning_loop_handoff_file` as the stable follow-up refs.

## Routed execution branch signatures
- **Success branch:** `routed_step_result_file` exists, routed `step-result` has `routed_execution.mode=execute`, `adapter_response.status=success`, and raw adapter evidence reference is present.
- **Missing-prerequisite branch:** run status is `fail`; routed `step-result` has `adapter_response.status=blocked` and `adapter_response.output.failure_kind=missing-prerequisite`.
- **Policy-blocked branch:** run status is `fail`; routed `step-result` has `adapter_response.status=blocked` with non-empty delivery guardrail `blocking_reasons` or unsupported-adapter block metadata.

## Operator checks
- Run summary and scorecard files exist under `.aor/projects/<project_id>/reports/`.
- `target_checkout_root` exists and is a cloned checkout, not the control-plane repository root.
- `generated_project_profile_file` exists under `.aor/projects/<project_id>/state/` and is used for analyze/validate/verify.
- `routed_step_result_file` exists and references a routed step with `mode=execute`.
- `compiled_context_ref` is populated and matches routed context-compilation output.
- `adapter_raw_evidence_ref` is populated and referenced from routed adapter response.
- For release-shaped runs, `delivery_manifest_file` and `release_packet_file` must reference `repo_deliveries[0].repo_root == target_checkout_root`.
- For release-shaped runs, `repo_deliveries[0].changed_paths` must remain target-relative (no absolute paths, no `..`, no control-plane docs/backlog paths).
- Harness execution stays CLI-only and remains valid with web UI detached.
- Use `live-e2e-learning-loop.md` to hand off incidents and scorecards into backlog and quality follow-up.
- Use `live-e2e-w7-governance-closure.md` for wave-level governance closure rehearsal and smoke checks.
