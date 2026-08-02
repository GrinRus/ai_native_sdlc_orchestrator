# Canonical identifiers, path scopes, and reference bases

## Purpose

This cross-cutting contract defines the values that may become runtime keys,
filesystem segments, event identities, or write authorization inputs. Invalid
input is rejected; runtimes must not lowercase, transliterate, trim, or replace
characters to manufacture a valid value.

## Public identifier grammar

`project_id`, `mission_id`, `run_id`, `flow_id`, `step_id`, `attempt_id`,
`event_id`, `artifact_id`, and `packet_id` use one grammar:

```text
length: 1..128 characters
alphabet: lowercase ASCII letters, digits, dot, underscore, and hyphen
regex: ^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$
```

Consecutive dots (`..`), `/`, `\`, control characters, drive forms such as
`C:`, Unicode lookalikes, leading/trailing punctuation, and values that become
valid only after normalization are forbidden. Existing uppercase fixtures must
be migrated explicitly; two rejected values must never collapse into one
runtime directory or event identity.

Runtimes may derive a new public ID only from already-valid components. The
readable dot-joined form is retained when it fits the grammar; an overlong
derived value becomes `<type>-<sha256-prefix>`. This is deterministic identity
derivation, not normalization of invalid external input.

## Path-scope states

`allowed_paths` is a four-state authorization value:

| Input | State | Meaning |
|---|---|---|
| field absent | `absent` | write scope was not declared; this does not authorize writes |
| `[]` | `deny-all` | writes are explicitly forbidden |
| bounded patterns | `bounded` | only matching project-relative paths are in scope |
| `['**']` or `['**/*']` | `unrestricted` | full project scope was explicitly requested and still requires policy approval |

Malformed input is a contract error, never an empty or unrestricted scope.
Every item is a project-relative POSIX pattern. Absolute paths, drive paths,
backslashes, empty segments, `.`/`..`, CR/LF/control characters, character
classes, and `?` are forbidden.

`*` matches characters inside one path segment. `**` is valid only as a whole
segment and matches zero or more segments. Therefore:

| Pattern | Candidate | Result |
|---|---|---|
| `source/*.ts` | `source/index.ts` | match |
| `source/*.ts` | `source/nested/index.ts` | no match |
| `source/*.ts` | `source/index.js` | no match |
| `source/**` | `source/nested/index.ts` | match |
| `source/**` | `source-escape/index.ts` | no match |

Rename and copy authorization checks both the source and destination. Delete
authorization checks the deleted source path. A path outside scope cannot be
moved or deleted merely because the destination is inside scope. Git status is
read in NUL-delimited form so spaces, Unicode, CR/LF, and both rename endpoints
remain data rather than parser syntax.

## Canonical reference bases

Every relative or evidence reference declares exactly one base:

| Base | Owner | Examples |
|---|---|---|
| `project-relative` | canonical target project root | source inputs, profiles, project-owned assets |
| `runtime-relative` | canonical AOR runtime root or project runtime root named by the field contract | reports, journals, caches, runtime evidence files |
| `evidence-relative` | evidence namespace and owning project/run | `evidence://...` references |
| `repository-bound` | explicit repository identity plus its canonical checkout root | multirepo paths and delivery targets |

After a project context exists, launcher `process.cwd()` is never a fallback
base. Read-only resolution must not materialize a runtime. Evidence lookup must
verify project ownership before returning a target.

Before filesystem use, the declared root and every existing ancestor are
checked with `lstat` and `realpath`. Symlinks or junctions that resolve outside
the declared boundary are rejected, including when the final leaf does not yet
exist.

## Compatibility and migration

- Replace uppercase or path-derived IDs with an explicitly chosen canonical ID;
  do not silently rewrite persisted state.
- Replace Windows separators with a reviewed project-relative POSIX scope in
  the source contract rather than at runtime.
- Use `[]` for intentional no-write, and use `**` only when a policy explicitly
  permits full-project scope.
- Add a declared reference base at ingress for legacy relative references.
- Ambiguous or collision-equivalent persisted state requires operator-directed
  migration and is not automatically merged.

The executable rules live in `packages/contracts/src/canonical-values.mjs`;
Git endpoint preservation and canonical ancestor checks live in the
orchestrator shared path helpers.
