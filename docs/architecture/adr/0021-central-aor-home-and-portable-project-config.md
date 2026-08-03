# ADR 0021: Central AOR Home and portable project configuration

- Status: accepted for W67
- Date: 2026-08-03
- Supersedes: ADR 0001

## Context

Repo-local `.aor/` runtime state makes project attachment look like a source
mutation, couples machine history to one checkout, and forces operators to
understand runtime-root and topology details before submitting useful work.
The Local Workspace registry already owns machine-local project and binding
state, so mutable runtime ownership should follow that boundary.

## Decision

AOR stores all mutable state under `AOR_HOME`, defaulting to `~/.aor`.
`workspace/registry.json`, project state/evidence, raw intent inputs, managed
clones, and temporary workspaces are AOR-owned machine state. A collision-safe
workspace project ID owns the physical project directory; the logical runtime
project ID remains packet identity.

Connected repositories receive no implicit AOR writes. `.aor/project.yaml` is
portable, explicitly materialized configuration. `.aor/exports/**` contains
only explicitly selected evidence exports. Neither location is runtime state.

The cutover is intentionally breaking. W67 does not read, migrate, overwrite,
or delete historical repo-local runtime directories. A conflicting legacy
`.aor` blocks portable materialization until the operator resolves it.

## Consequences

- `AOR_HOME` is the only public storage override; public `runtime_root` inputs
  disappear.
- Evidence references are logical and resolve through project context instead
  of exposing physical home paths.
- Same-name repositories remain distinct through source-identity hashing.
- Backup, retention, disconnect, and deletion operate on AOR Home, not Git.
- Portable config and exports require separate write previews and never stage,
  commit, or push changes.

## Follow-up

W67 must update filesystem permissions, contracts, examples, CLI/API/web
surfaces, installed-package proof, and user-facing recovery guidance together.
