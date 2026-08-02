# ADR 0020: Separate portable topology from machine-local bindings

- Status: accepted
- Date: 2026-07-16

## Decision

A Local Workspace is operator-owned machine state containing explicit AOR
Projects. An AOR Project owns one portable `project-profile`, independent flow
and runtime evidence, and one or more Repository definitions. A Repository is a
physical Git identity. Apps, packages, and services inside a monorepo are
Components, not additional repositories. A Project Binding maps those portable
repository IDs to machine-local checkouts. A Workspace Set freezes the exact
binding, mount, ref, commit, access, and scope identities intended for one
execution.

Portable profiles may contain only repository-relative topology and non-secret
clone metadata. Absolute paths and credential values belong only to the
operator-local binding store. Multiple projects may reference one physical
repository for reads; write-capable use requires non-overlapping scopes and
blocking conflict evidence.

## Consequences

Existing `source.root` remains a compatibility alias for `workspace_mount`.
Legacy profiles load with empty component collections. W61-S02 owns persistent
binding storage; W62 owns actual workspace provisioning.
