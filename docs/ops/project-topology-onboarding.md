# Project topology onboarding

Use the Local Workspace to register projects and machine-local bindings without
placing absolute checkout paths in the portable project profile.

## Public workflow

1. Add or import an AOR Project with `aor project add|import`.
2. Inspect and edit repositories, components, and dependencies with the
   `aor project repository|component|dependency` command families.
3. Run `aor project topology --action validate`.
4. Select only an approved route preset through `aor route select`, then run
   `aor route check`.
5. Initialize project runtime state in AOR Home through an explicit mutation when a mission is ready. Portable repository configuration is materialized separately.

The project profile owns portable repository/component topology and route
selection. The Local Workspace registry owns checkout bindings and
credential-free readiness summaries. Runtime evidence remains under
`${AOR_HOME:-$HOME/.aor}/projects/<workspace-project-id>/`.

## Recovery

- `unavailable`, `not-git`, or `permission-denied`: rebind the repository to an
  accessible Git checkout without changing the portable repository identity.
- `ref-drift`: inspect the resolved Git identity and approve the intended base
  ref before execution.
- `stale` execution readiness: run `aor route check` again.
- active-run conflicts: finish or cancel the active run before changing
  topology or route selection.

The W61 topology and readiness component proof is reproduced with
`node scripts/w61-topology-onboarding-proof.mjs`. It uses disposable local Git
repositories, makes no provider or upstream calls, and emits sanitized summary
evidence backed by core control-plane tests. Its browser assessment is `not-run`;
current installed-user acceptance requires separate Task Workspace proof.
