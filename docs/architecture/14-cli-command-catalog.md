# CLI command catalog

This catalog separates bootstrap commands implemented in the current shell from roadmap-only commands.

## Implemented bootstrap shell commands (W1-S01)

| Command | Status | Inputs | Outputs | Contract family |
| --- | --- | --- | --- | --- |
| `aor project init` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `contract_families`, `command_catalog_alignment` | `project-profile` |
| `aor project analyze` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `contract_families`, `command_catalog_alignment` | `project-analysis-report` |
| `aor project validate` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `contract_families`, `command_catalog_alignment` | `validation-report` |
| `aor project verify` | implemented | `--project-ref <path>`; `--runtime-root <path>` (optional) | `resolved_project_ref`, `resolved_runtime_root`, `contract_families`, `command_catalog_alignment` | `step-result` |

Implemented command behavior in W1-S01 is command-contract validation only: unknown commands, missing required flags, and invalid project refs fail with explicit errors.

## Planned command contracts
The following commands remain planned and are intentionally not implemented in the bootstrap shell yet.

- `aor intake create`
- `aor discovery run`
- `aor spec build`
- `aor wave create`
- `aor handoff prepare`
- `aor handoff approve`

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
