# Verification command groups migration

Use `verification.command_groups[]` for new project profiles and migrated
profiles. Legacy per-repo command lists and CLI override flags remain supported,
but command groups are the executable verification contract that `project init`,
`project verify --plan`, API project state, and the web console can inspect.

## Migration mapping

| Legacy source | Command-group mapping |
| --- | --- |
| `repos[].build_commands[]` | `role: build`, `enforcement: required`, `timeout_class: build` |
| `repos[].lint_commands[]` | `role: lint`, `enforcement: required` unless intentionally downgraded, `timeout_class: quick` |
| `repos[].test_commands[]` | `role: test`, `enforcement: required`, `timeout_class: focused-test` |
| CLI `--repo-build-command` | temporary `cli-build` command group for the selected verification label |
| CLI `--repo-lint-command` | temporary `cli-lint` command group for the selected verification label |
| CLI `--repo-test-command` | temporary `cli-test` command group for the selected verification label |

When a profile does not define `verification.command_groups[]`, `project verify`
normalizes legacy repo command lists into required command groups at runtime. The
legacy fields are compatibility inputs only; do not remove them from existing
profiles until downstream users have migrated.

## Recommended steps

1. Run a dry plan before editing the profile:

   ```sh
   aor project verify --project-ref . --plan
   ```

2. Add command groups to the project profile. Start with baseline and
   post-change `build`, `lint`, and `test` groups, then add `setup`,
   `typecheck`, `e2e`, `full-suite`, or `custom` groups only when the target
   project actually has those commands.

3. Bind each group to `repo_id` and `working_dir` for monorepos and bounded
   multirepo projects. Add `depends_on[]` when a setup or build group must pass
   before later checks run.

4. Preserve `detected_from[]`, `package_manager`, and `tool_requirements[]` when
   the source is known. These fields are authoring metadata for operators and
   do not change command execution by themselves.

5. Re-run the plan and inspect the generated status surface:

   ```sh
   aor project verify --project-ref . --verification-label post-change-primary --plan
   ```

6. Run the selected checks only after the plan is correct:

   ```sh
   aor project verify --project-ref . --verification-label post-change-primary
   ```

## Enforcement and evidence

`required` groups are acceptance candidates. A failed required group fails the
verify summary unless the group is skipped because a required dependency already
failed. Skipped dependent groups must still emit evidence so operators can see
which prerequisite caused the skip.

`warn` groups produce warning evidence. They are useful for lint, browser, or
environment-sensitive checks, but they are not acceptance evidence and must not
be used to claim the product is verified.

`observe` groups are informational. They can record long full-suite, exploratory,
or migration-only checks, but they are never acceptance evidence.

Timeouts are per command, not per lifecycle run. Use `install` for dependency
setup, `build` for compilation and type generation, `focused-test` for targeted
unit or integration checks, `browser-e2e` for browser automation, `full-suite`
for long broad checks, and `quick` for short lint or metadata checks.

## Special outcomes

`no-tests` means AOR found no runnable test or browser command for a package
boundary. Do not create a fake passing command group. Record
`verification.discovery_outcomes[]` and add a `custom` discovery suggestion when
operators must author a project-specific command.

`missing-tool` means the command could not run because a required binary or
runtime was unavailable. Use `tool_requirements[]` and `skip_policy` to make the
missing prerequisite explicit.

`not-applicable` is for a known verification group that does not apply to the
current project shape or platform.

`broken-baseline` means an unchanged baseline command already fails. Treat it as
baseline repair or rebaseline work before post-change verification can be
accepted.

## Example profile

See `examples/project.verification-archetypes.aor.yaml` for Node, Python,
monorepo, browser e2e, no-tests, and broken-baseline command-group examples.
