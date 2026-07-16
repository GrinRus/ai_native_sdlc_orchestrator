# Project topology onboarding

Use the Local Workspace to register projects and machine-local bindings without
placing absolute checkout paths in the portable project profile.

## Public workflow

1. Add or import an AOR Project with `aor project add|import`.
2. Inspect and edit repositories, components, and dependencies with the
   `aor project repository|component|dependency` command families or Project
   Structure in the installed app.
3. Run `aor project topology --action validate`.
4. Select only an approved route preset through `aor route select` or Execution
   Setup, then run `aor route check`.
5. Initialize `.aor` only through an explicit mutation when a mission is ready.

The project profile owns portable repository/component topology and route
selection. The Local Workspace registry owns checkout bindings and
credential-free readiness summaries. Runtime evidence remains under `.aor/`.

## Recovery

- `unavailable`, `not-git`, or `permission-denied`: rebind the repository to an
  accessible Git checkout without changing the portable repository identity.
- `ref-drift`: inspect the resolved Git identity and approve the intended base
  ref before execution.
- `stale` execution readiness: run `route check` or **Check setup** again.
- active-run conflicts: finish or cancel the active run before changing
  topology or route selection.

The W61 deterministic closure is reproduced with
`node scripts/w61-topology-onboarding-proof.mjs`. It uses disposable local Git
repositories, makes no provider or upstream calls, and emits only sanitized
summary evidence.
