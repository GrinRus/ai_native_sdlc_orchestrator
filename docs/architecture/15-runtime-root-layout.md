# Runtime root layout

## Purpose
Define the deterministic `.aor/` structure created by `aor project init` so later bootstrap and packet slices can reuse the same durable paths.

## Discovery and initialization
`aor project init` resolves project runtime state in this order:
1. discover project root from `--project-ref` or current working directory;
2. resolve project profile from `--project-profile` or default candidates (`project.aor.yaml`, `examples/project.aor.yaml`, `examples/project.github.aor.yaml`);
3. when no profile exists and materialization is not requested, generate a bundled-mode profile under `.aor/` with registry roots pointing to installed AOR assets;
4. resolve runtime root from `--runtime-root` override or `runtime_defaults.runtime_root` in the selected project profile;
5. create the runtime directory layout idempotently and emit an onboarding report.

## Directory structure
For project `<project_id>`, the runtime layout is:

```text
.aor/
  projects/
    <project_id>/
      artifacts/
        <project_id>.artifact.bootstrap.v1.json
        <project_id>.artifact.bootstrap.v1.body.json
        wave-ticket-*.json
        <project_id>.handoff.bootstrap.v1.json
        delivery-plan-*.json
      reports/
        onboarding-report.json
        project-analysis-report.json
        route-resolution-report.json
        asset-resolution-report.json
        policy-resolution-report.json
        validation-report.json
        evaluation-report-*.json
        verify-summary.json
        step-result-*.json
        harness-capture-*.json
        harness-replay-*.json
        verify-command-*.log
      state/
        project.aor.yaml
        project-init-state.json
```

`state/project.aor.yaml` is present when bundled clean onboarding generated the project profile inside `.aor/`; materialized or explicitly supplied profiles remain at their selected target path.

## Durable state file
`project-init-state.json` records:
- `project_id`
- `display_name`
- `selected_profile_ref`
- `project_root`
- `runtime_root`
- `asset_mode`
- `registry_roots`
- `onboarding_report_ref`
- `runtime_layout` paths (`project_runtime_root`, `artifacts_root`, `reports_root`, `state_root`)

The first bootstrap packet created by `project init` records packet metadata plus invocation/evidence linkage and can be reloaded directly from `<project_id>.artifact.bootstrap.v1.json`.

## Idempotency
Repeated `aor project init` runs against the same project root must:
- keep the same runtime root and project runtime paths;
- keep the same state file path;
- rewrite deterministic state content without creating duplicate directory trees.
