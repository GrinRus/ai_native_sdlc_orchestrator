# Project binding

## Purpose

`project-binding` maps portable repository identities from one `project-profile`
to machine-local checkouts. It is operator-local state and must never be
committed into the target project profile or runtime evidence bundle.

## Required fields

- `binding_id`, `project_id`, `profile_ref`, and monotonic `revision`
- `repositories[]` with `repo_id`, optional absolute `local_path` or
  non-secret `clone_source`, resolved repository identity/commit, availability
  `status`, and redacted `credential_readiness`

Credential readiness records only status and mechanism. Tokens, passwords,
private keys, environment values, and credential payloads are forbidden.
Bindings may point outside the portable project root and are resolved only
through the operator-local Workspace registry.

## Compatibility and lifecycle

Bindings are revisioned independently from portable profile revisions. A rebind
invalidates machine readiness and future workspace sets. It invalidates an
approved plan only when resolved repository identity or base ref changes.

See `examples/bindings/aor-core.local.yaml`.
