# Runtime root layout

## Purpose
Define the deterministic `.aor/` structure created by `aor project init` so later bootstrap and packet slices can reuse the same durable paths.

## Discovery and initialization
`aor project init` resolves project runtime state in this order:
1. discover project root from `--project-ref` or current working directory;
2. resolve project profile from `--project-profile` or default candidates (`project.aor.yaml`, `examples/project.aor.yaml`, `examples/project.github.aor.yaml`);
3. resolve runtime root from `--runtime-root` override or `runtime_defaults.runtime_root` in the selected project profile;
4. create the runtime directory layout idempotently.

## Directory structure
For project `<project_id>`, the runtime layout is:

```text
.aor/
  projects/
    <project_id>/
      artifacts/
      reports/
      state/
        project-init-state.json
```

## Durable state file
`project-init-state.json` records:
- `project_id`
- `display_name`
- `selected_profile_ref`
- `project_root`
- `runtime_root`
- `runtime_layout` paths (`project_runtime_root`, `artifacts_root`, `reports_root`, `state_root`)

## Idempotency
Repeated `aor project init` runs against the same project root must:
- keep the same runtime root and project runtime paths;
- keep the same state file path;
- rewrite deterministic state content without creating duplicate directory trees.
