# Task source item

`task-source-item` is the additive, immutable source projection used by Task
Workspace. It describes one bounded input without exposing a client filesystem
path or executable content.

Required fields are `schema_version: 1`, stable `source_id`, `kind`
(`upload-snapshot`, `repository-markdown`, or `inline-text`), `immutable: true`,
`stale`, a SHA-256 `digest`, and a sanitized `preview` object.

Upload snapshots contain bounded UTF-8 bytes, filename, media type, byte length,
and digest. Repository Markdown contains a project-relative path, pinned base
revision, and digest. Inline text is stored as an immutable submission snapshot.
Public read models never return a client absolute path.

Previews strip scripts, raw HTML execution, remote embeds, and automatic network
loads. Rendering a preview never executes Markdown content.
