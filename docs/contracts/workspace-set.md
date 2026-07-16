# Workspace set

## Purpose

`workspace-set` is the immutable run-owned provisioning manifest for the
repositories used by execution, verification, review, Runtime Harness, and
delivery. W61 introduced the planning identity; schema version 2 adds exact
checkout roots, provisioning state, cleanup state, and repository-local Git
evidence without changing portable project profiles or machine-local bindings.

## Required fields

- `schema_version`, `workspace_set_id`, `project_id`, `run_id`, `binding_ref`,
  `status`, `workspace_root`, and `owner_marker`
- `repositories[]` with stable `mount_path`, binding/base/commit identity,
  `access_mode`, explicit `write_scope`, provisioning strategy/state,
  execution root, and baseline/final Git evidence
- `conflicts[]` with deterministic blocking evidence
- `cleanup` with success/abort/failure policy and current state
- `evidence_refs[]` for the persisted manifest and retained failure evidence

Mount paths are unique portable relative paths. A shared physical repository
may appear more than once only when every use is read-only or when writable
scopes are proven non-overlapping. Ambiguous or equivalent write scopes fail
closed.

The manifest is published only after every participating repository resolves
to the requested commit. Delivery-capable execution never points at a primary
checkout. A partial provisioning failure removes owned disposable checkouts
and persists failure evidence outside the disposable workspace. Cleanup is
idempotent and refuses targets without a matching owner marker.

`repositories[].git_evidence` keeps baseline and final state separate per
repository. It records HEAD, NUL-safe status entries (including both rename
paths), tracked/untracked changed paths, and ignored runner scratch paths.
Consumers must use `workspace_set_ref` and the manifest repository map;
launcher `cwd` and primary-checkout fallback are forbidden after provisioning.

See `examples/workspace-sets/aor-core.no-write.yaml`.
