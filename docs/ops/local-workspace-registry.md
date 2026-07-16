# Local Workspace registry

The installed local app persists explicitly connected AOR Projects under the
AOR-owned user-state root. `AOR_HOME` overrides that root for isolated
rehearsals; otherwise AOR uses the platform application-state directory. The
current registry file is `workspace/registry.json`.

The registry uses schema version 1, monotonic revisions, an atomic sibling-file
rename, and a bounded cross-process lock. A malformed registry is renamed to a
timestamped `.corrupt.*` file before an empty registry is exposed. Tests pass an
explicit ephemeral mode or isolated registry root.

The registry stores project/profile/runtime references, labels, and redacted
repository-binding summaries. It does not store credentials or runtime
evidence. Repository and component discovery is proposal-only: every candidate
retains confidence and source refs until a later explicit topology mutation
accepts it.

Bare `aor app` outside Git opens the neutral default Workspace with
`selected_project_id=null`. It does not scan the machine, restore a sticky CLI
project, initialize `.aor`, or write into the launcher directory. Running
`aor app` inside a repository selects that explicit attached project only for
the current app session.
