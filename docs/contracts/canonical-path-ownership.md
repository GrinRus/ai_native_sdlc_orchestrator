# Canonical path ownership

Filesystem references are capabilities, not strings. Every operation that
reads repository or evidence content, materializes an artifact, copies a tree,
or removes a workspace must resolve the reference against one declared
canonical root before touching the filesystem.

## Ownership algorithm

1. The boundary is canonicalized with `realpath`; a missing or unreadable
   boundary fails closed.
2. The reference is a literal POSIX relative path for its declared base. Empty,
   absolute, Windows-drive, backslash, NUL, dot-segment, and `..` forms are
   rejected before filesystem access. A sibling prefix such as
   `/runtime/projects-x` is not inside `/runtime/projects`.
3. Every existing ancestor is inspected with `lstat` and `realpath`. A
   symlink/junction that resolves outside the boundary is rejected, including
   when the final leaf does not yet exist. Protected reads reject a final
   symlink even when it resolves inside the boundary.
4. Protected reads open the validated path with `O_NOFOLLOW` when the platform
   provides it, compare the descriptor identity (`dev`, `ino`, and size) with a
   fresh `lstat`, and only then consume bytes. A replacement or unreadable file
   is a typed failure, never a fallback to a lexical path.
5. Recursive deletion may target only a non-root path below the canonical
   ownership root. The target and its owner marker are derived from the
   canonical runtime owner; a manifest-supplied absolute path is not trusted.

## Owner markers and cleanup

An owner marker is a small JSON record containing the canonical project/source
root, execution/workspace root, public run/workspace-set identity, and
provisioning strategy. The marker must match the requested target byte-for-byte
after canonicalization. Missing, malformed, forged, or mismatched markers fail
closed and preserve the target.

Cleanup state is persisted atomically beside the marker and follows this
transition:

`pending -> deleting -> deleted`

Any failed transition records `delete-failed` with the error and leaves the
workspace available for an explicit retry when removal was incomplete. A retry
is idempotent: `deleted` is already complete, while `deleting` re-validates
ownership before attempting the owned removal again. The `deleted` marker is
written only after the owned root (and its owner marker, when separate) has
been removed. The primary checkout, external sentinels, and unrelated runtime
roots are never deletion targets.

## Examples (all fail closed)

| Reference or state | Expected result |
| --- | --- |
| `../outside.md` | lexical traversal rejected |
| root `/runtime/projects`, candidate `/runtime/projects-old/file` | sibling-prefix escape rejected |
| `docs/link/secret.md`, where `docs/link` points outside | nested symlink escape rejected |
| `docs/alias.md`, where the final leaf is a symlink | protected read rejected |
| `docs/missing.md` below an owned root | read reports missing; no outside fallback |
| owner marker with another `execution_root` or invalid JSON | cleanup records `delete-failed`; target and sentinel remain |
| cleanup called twice after `deleted` | second call is a no-op with the same terminal result |

All contract families that carry `*_path`, `*_root`, `*_ref`, evidence, or
workspace ownership inherit these rules from
`canonical-identifiers-and-paths.md` and this document.
