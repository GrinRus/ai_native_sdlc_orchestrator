# CLI command catalog

This catalog separates bootstrap commands implemented in the current shell from roadmap-only commands.

## Implemented CLI commands

| Command | Status | Inputs | Outputs | Contract family |
| --- | --- | --- | --- | --- |
| `aor project init` | implemented | `--project-ref <path>` (optional); `--project-profile <path>` (optional); `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `project_profile_ref`, `runtime_layout`, `runtime_state_file`, `artifact_packet_id`, `artifact_packet_file`, `contract_families`, `command_catalog_alignment` | `project-profile` |
| `aor project analyze` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--route-overrides <step=route_id,...>` (optional); `--policy-overrides <step=policy_id,...>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `analysis_report_id`, `analysis_report_file`, `route_resolution_file`, `route_resolution_steps`, `asset_resolution_file`, `asset_resolution_steps`, `policy_resolution_file`, `policy_resolution_steps`, `evaluation_registry_file`, `evaluation_registry_suites`, `evaluation_registry_datasets`, `contract_families`, `command_catalog_alignment` | `project-analysis-report` |
| `aor project validate` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--require-approved-handoff` (optional); `--handoff-packet <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `validation_report_id`, `validation_report_file`, `validation_status`, `validation_blocking`, `handoff_gate_enforced`, `handoff_gate_status`, `handoff_gate_blocking`, `handoff_packet_file`, `contract_families`, `command_catalog_alignment` | `validation-report` |
| `aor project verify` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--require-validation-pass` (optional); `--routed-dry-run-step <step_class>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `validation_gate_enforced`, `validation_gate_status`, `verify_summary_file`, `step_result_files`, `routed_step_result_id`, `routed_step_result_file`, `contract_families`, `command_catalog_alignment` | `step-result` |
| `aor eval run` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--suite-ref <suite_id@vN>` (optional); `--subject-ref <subject_type://target>`; `--subject-version <version>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `evaluation_report_id`, `evaluation_report_file`, `evaluation_status`, `evaluation_blocking`, `evaluation_suite_ref`, `evaluation_subject_ref`, `contract_families`, `command_catalog_alignment` | `evaluation-report` |
| `aor harness certify` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--asset-ref <asset://target>`; `--subject-ref <subject_type://target>`; `--suite-ref <suite_id@vN>` (optional); `--step-class <step_class>` (optional); `--from-channel <channel>` (optional); `--to-channel <channel>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `promotion_decision_id`, `promotion_decision_file`, `promotion_decision_status`, `certification_evaluation_report_file`, `certification_harness_capture_file`, `certification_harness_replay_file`, `contract_families`, `command_catalog_alignment` | `promotion-decision` |
| `aor handoff prepare` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--ticket-id <id>` (optional); `--approved-artifact <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `wave_ticket_id`, `wave_ticket_file`, `handoff_packet_id`, `handoff_packet_file`, `handoff_status`, `handoff_approval_state`, `contract_families`, `command_catalog_alignment` | `wave-ticket`, `handoff-packet` |
| `aor handoff approve` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional); `--handoff-packet <path>` (optional); `--approval-ref <ref>` | `resolved_project_ref`, `resolved_runtime_root`, `handoff_packet_id`, `handoff_packet_file`, `handoff_status`, `handoff_approval_state`, `contract_families`, `command_catalog_alignment` | `handoff-packet` |
| `aor run status` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional); `--run-id <id>` (optional); `--follow <true\|false>` (optional); `--after-event-id <event_id>` (optional); `--max-replay <number>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `run_summaries`, `follow_mode`, `stream_protocol`, `stream_backpressure`, `replay_events`, `read_only`, `future_control_hooks`, `contract_families`, `command_catalog_alignment` | `live-run-event`, `step-result`, `delivery-manifest`, `release-packet`, `promotion-decision` |
| `aor packet show` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional); `--family <contract_family\|all>` (optional); `--limit <number>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `packet_artifacts`, `selected_family`, `read_only`, `future_control_hooks`, `contract_families`, `command_catalog_alignment` | `artifact-packet`, `wave-ticket`, `handoff-packet`, `delivery-plan`, `delivery-manifest`, `release-packet` |
| `aor evidence show` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional); `--run-id <id>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `step_results`, `quality_artifacts`, `delivery_manifests`, `promotion_decisions`, `read_only`, `future_control_hooks`, `contract_families`, `command_catalog_alignment` | `step-result`, `validation-report`, `evaluation-report`, `promotion-decision`, `delivery-manifest`, `release-packet` |

`aor eval run` (W3-S03) and `aor harness certify` (W3-S05) provide the quality-runtime baseline: durable eval output plus durable certification and promotion-decision artifacts.

## Planned command contracts
The following commands remain planned and are intentionally not implemented in the bootstrap shell yet.

- `aor intake create`
- `aor discovery run`
- `aor spec build`
- `aor wave create`

- `aor run start`
- `aor run pause`
- `aor run resume`
- `aor run steer`
- `aor run cancel`

- `aor harness replay`
- `aor asset promote`
- `aor asset freeze`

- `aor deliver prepare`
- `aor release prepare`

- `aor incident open`
- `aor incident show`
- `aor audit runs`

- `aor live-e2e start`
- `aor live-e2e status`
- `aor live-e2e report`
- `aor ui attach`
- `aor ui detach`

## Operator semantics for W5-S03
- `aor run status`, `aor packet show`, and `aor evidence show` are read-only operator commands.
- `aor run status --follow` reuses the shared live-run stream contract and backpressure semantics from the control-plane event stream.
- Future control hooks remain explicit and planned:
  - run control: `aor run pause`, `aor run resume`, `aor run steer`, `aor run cancel`
  - delivery control: `aor deliver prepare`, `aor release prepare`
  - incident/audit control: `aor incident open`, `aor incident show`, `aor audit runs`
