# Task review read model

`task-review` is the bounded, query-safe read model used by the installed Task
Workspace `Review Changes` screen. It describes reviewable change evidence; it
does not approve changes, mutate lifecycle state, materialize delivery, or make
the browser an evidence owner.

## Required fields

- `schema_version`: currently `1`.
- `task_id`, `project_id`: stable public Task and Project identities.
- `availability`: `available`, `empty`, `binary`, `truncated`, or `unavailable`.
- `files`: bounded changed-file summaries.
- `selected_path`: selected project-relative path or `null`.
- `selected_file`: selected file detail or `null`.
- `evidence_refs`: query-safe durable evidence lineage.
- `freshness`: source update and stale-state summary.
- `read_only`: always `true`.

Each `files[]` entry contains `path`, `kind`, non-negative `additions` and
`deletions`, `diff_available`, and `truncated`. Paths are normalized
project-relative POSIX paths. Absolute paths, parent traversal, backslashes,
NUL bytes, and paths outside the recorded changed-file set are rejected before
filesystem or Git reads.

`selected_file` contains:

- the same file summary fields;
- `hunks[]` with bounded unified-diff coordinates and rows;
- each row has `kind=context|addition|deletion`, nullable `old_line` and
  `new_line`, and bounded plain `text`;
- optional `rendered.before` and `rendered.after` Markdown excerpts with
  `sanitized=true` and `partial` truth;
- `source_ref` for the exact patch, step result, or delivery evidence used.

## Bounds and failure behavior

- The endpoint returns at most 200 files, 2000 diff rows, 64 KiB per rendered
  excerpt, and 512 KiB of source patch input.
- Oversized evidence is truncated with explicit `truncated=true`; it is never
  silently presented as complete.
- Binary changes return metadata with `availability=binary` and no fabricated
  text rows.
- A known Task without review evidence returns `200` with
  `availability=unavailable` or `empty`; an unknown Task returns
  `404 task.not_found`.
- An unsafe or unrecorded selected path returns `400 task.review_path_invalid`.
- Active HTML, scripts, event handlers, data URLs, remote embeds, automatic
  network fetches, absolute local paths, and unsanitized artifact bodies never
  appear in the response.

## Ownership and compatibility

The Runtime, review, step-result, and delivery artifacts remain authoritative.
The read model may use an owned disposable Git workspace while it exists or a
recorded patch artifact after cleanup. It exposes only bounded display data and
durable refs. Existing Task list/detail payloads remain backward compatible;
consumers opt into the separate review route.
