# Evidence reference

Evidence references identify immutable bytes owned by one AOR project runtime.
The canonical form is:

`evidence://projects/<workspace_project_id>/<runtime-relative-posix-path>`

Legacy `evidence://<runtime-relative-posix-path>` references remain readable
only when the caller supplies the owning project runtime. Absolute filesystem
paths are accepted at local ingestion boundaries for compatibility and are
immediately checked against the project/runtime roots.

Resolvers reject empty values, control characters, backslashes, traversal,
absolute URI payloads, missing files, directories, and symlink/junction escapes.
They return the canonical file path, bytes, and SHA-256 digest. A supplied
digest must match exactly; a mismatch is a blocking `evidence-digest-mismatch`
failure.

Stored evidence is content-addressed under
`<project-runtime>/evidence/<project-id>/<sha256>/<filename>` and has a sidecar
authority record binding project identity, optional run/task/unit/attempt/repo
lineage, redaction metadata, and the byte digest. Consumers must resolve the
shared reference before asserting delivery, review, integration, or release
success.

