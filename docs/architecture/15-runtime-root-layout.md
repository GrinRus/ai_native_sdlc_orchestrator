# AOR Home runtime layout

## Purpose
Define the deterministic AOR-owned structure under `AOR_HOME`, defaulting to
`~/.aor`. Connected repositories are read targets until an operator explicitly
materializes portable configuration or exports selected evidence.

## Discovery and initialization
W67 resolves mutable storage in this order:

1. use `AOR_HOME` when present, otherwise `~/.aor`;
2. resolve the connected source identity and collision-safe workspace project ID;
3. load the Workspace registry from `<aor-home>/workspace/registry.json`;
4. resolve project runtime state from `<aor-home>/projects/<workspace-project-id>`;
5. never discover or read a repo-local runtime root;
6. write only through project-scoped staging and same-filesystem rename.

Public commands and API payloads do not accept `runtime_root`. Internal tests
isolate state by overriding `AOR_HOME`.

## Canonical tree

```text
~/.aor/
  workspace/
    registry.json
  projects/
    <workspace-project-id>/
      state/
      artifacts/
      reports/
      inputs/
      workspaces/
  repositories/
    <repository-id>/
      checkout/
  tmp/
```

Directories are mode `0700` and regular state/input files are mode `0600`
where supported. Physical AOR Home paths are not durable public references.

## Repository-owned portable output

Only explicit actions may write:

```text
<project>/.aor/project.yaml
<project>/.aor/exports/<flow-id>/<export-id>/
```

Portable profiles exclude absolute paths, credentials, readiness state, and
runtime roots. Evidence exports contain only selected refs plus a digest
manifest. AOR never stages, commits, or pushes these files.

## Breaking boundary

Pre-W67 repo-local runtime trees are not loaded or migrated. AOR never deletes
them. If an existing `.aor` cannot safely coexist with portable output,
materialization fails with an operator-visible recovery action.

Repeated initialization preserves the same workspace project ID and replaces
only the complete project-scoped state tree. Interrupted staging directories are
removed only by the transaction that owns their marker. Linked worktrees and
detached HEAD states are discovered through Git without changing the source.
