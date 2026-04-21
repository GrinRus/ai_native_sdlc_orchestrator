# CLI command catalog

This catalog separates bootstrap commands implemented in the current shell from roadmap-only commands.

## Implemented bootstrap shell commands (W1-S01)

| Command | Status | Inputs | Outputs | Contract family |
| --- | --- | --- | --- | --- |
| `aor project init` | implemented | `--project-ref <path>` (optional); `--project-profile <path>` (optional); `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `project_profile_ref`, `runtime_layout`, `runtime_state_file`, `artifact_packet_id`, `artifact_packet_file`, `contract_families`, `command_catalog_alignment` | `project-profile` |
| `aor project analyze` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--route-overrides <step=route_id,...>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `analysis_report_id`, `analysis_report_file`, `route_resolution_file`, `route_resolution_steps`, `contract_families`, `command_catalog_alignment` | `project-analysis-report` |
| `aor project validate` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--require-approved-handoff` (optional); `--handoff-packet <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `validation_report_id`, `validation_report_file`, `validation_status`, `validation_blocking`, `handoff_gate_enforced`, `handoff_gate_status`, `handoff_gate_blocking`, `handoff_packet_file`, `contract_families`, `command_catalog_alignment` | `validation-report` |
| `aor project verify` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--require-validation-pass` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `validation_gate_enforced`, `validation_gate_status`, `verify_summary_file`, `step_result_files`, `contract_families`, `command_catalog_alignment` | `step-result` |
| `aor handoff prepare` | implemented | `--project-ref <path>`; `--project-profile <path>` (optional); `--runtime-root <path>` (optional); `--ticket-id <id>` (optional); `--approved-artifact <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `wave_ticket_id`, `wave_ticket_file`, `handoff_packet_id`, `handoff_packet_file`, `handoff_status`, `handoff_approval_state`, `contract_families`, `command_catalog_alignment` | `wave-ticket`, `handoff-packet` |
| `aor handoff approve` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional); `--handoff-packet <path>` (optional); `--approval-ref <ref>` | `resolved_project_ref`, `resolved_runtime_root`, `handoff_packet_id`, `handoff_packet_file`, `handoff_status`, `handoff_approval_state`, `contract_families`, `command_catalog_alignment` | `handoff-packet` |

Implemented command behavior in W1-S01 is command-contract validation only: unknown commands, missing required flags, and invalid project refs fail with explicit errors.

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
- `aor run status`

- `aor eval run`
- `aor harness replay`
- `aor harness certify`
- `aor asset promote`
- `aor asset freeze`

- `aor deliver prepare`
- `aor release prepare`
- `aor packet show`
- `aor evidence show`

- `aor incident open`
- `aor incident show`
- `aor audit runs`

- `aor live-e2e start`
- `aor live-e2e status`
- `aor live-e2e report`
- `aor ui attach`
- `aor ui detach`
