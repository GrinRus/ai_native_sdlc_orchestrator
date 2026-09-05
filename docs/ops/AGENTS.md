# AGENTS.md

`docs/ops` holds operator-facing runbooks.

## Update this folder when
- an installed-user command or operational flow changes;
- a Task Workspace or headless attach/detach flow changes;
- an operator gate, approval, or recovery procedure changes.

Internal maintainer rehearsal procedures belong under `scripts/`; use
`scripts/AGENTS.md` to locate their owning guidance.

## Rules
- Write module-facing docs, examples, and comments in English.
- Keep runbooks executable and concise.
- Prefer exact commands and expected outputs over long prose.
- Default public-repo rehearsals to `no-write`. Use patch, branch, or fork/PR
  delivery only within the explicitly selected and authorized boundary.
- Distinguish AOR Home runtime state, portable repo-local `.aor/` config/exports,
  and ignored internal rehearsal outputs.
- Use the [validation matrix](../../CONTRIBUTING.md#validation-by-change-type)
  to distinguish successful check execution, alpha audit hold, and production
  clearance.
