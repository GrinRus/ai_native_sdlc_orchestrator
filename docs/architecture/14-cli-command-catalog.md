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

- `aor run start`
- `aor run pause`
- `aor run resume`
- `aor run steer`
- `aor run cancel`

- `aor eval run`
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

## Standard live E2E semantics for W5-S05
- `aor live-e2e start` is the standard orchestration entrypoint for target-catalog rehearsal profiles.
- `aor live-e2e status` is observe-first and supports bounded abort (`--abort=true`) for non-terminal runs.
- `aor live-e2e report` is read-only and returns durable run summary plus per-target scorecards.
- Learning-loop artifacts (`learning-loop-scorecard-*`, `learning-loop-handoff-*`, optional `incident-report-*`) are materialized under runtime reports for backlog and quality handoff.
