# Intent submission

## Purpose

Preserve exactly what an operator supplied before AOR or a provider derives a
Mission, acceptance criteria, scope, or execution recommendation.

## Required fields

- `submission_id`, `workspace_project_id`, `project_id`, and `revision`
- `status`: `submitted`, `preparing`, `prepared`, `blocked`, `confirmed`, or `canceled`
- `request_text`
- `attachments[]`
- `repository_snapshot[]`
- optional `markdown_sources[]` repository-relative, pinned Markdown snapshots
- optional `preparation_route_id`, a canonical `route.intake-normalize.*` ID
  selected for this submission
- optional `execution_route_override` with an approved execution `route_id` and
  its `step`; this is a task-scoped choice and does not change project defaults
- optional `runner_selection_revision`, the CAS revision for changing or
  clearing `execution_route_override`
- optional `source_lineage` with the prior same-project `source_submission_id`
  and the immutable `source_ids` copied into this submission
- `normalization_refs[]`
- `created_at` and `updated_at`

At least one of trimmed `request_text`, `attachments[]`, or `markdown_sources[]`
must be present.
Submissions are immutable except for status, normalization lineage, runner
selection, and timestamps. Operator changes create a new submission or
normalization revision.

## Attachments

W67 accepts at most ten UTF-8 files and 5 MiB total. Each file is at most 1 MiB
and uses `.txt`, `.md`, `.json`, `.yaml`, or `.yml`. Metadata requires
`attachment_id`, `original_name`, `media_type`, `byte_length`, `sha256`, and a
project-input-relative `storage_ref`. Client filenames never select disk paths.

Absolute storage paths and attachment content are not exposed through API read
models. Files are mode `0600` where supported.

## Safety

Creating a submission does not create a Flow, invoke a write-capable route, or
mutate connected repositories. Preparation may only use the read-only
`intake-normalize` route. Read-only constrains repository effects; preparation
may start the selected runner to normalize the brief. When preparation is part
of the requested operation, the selected route is resolved and checked before
the submission is persisted, whether preparation runs asynchronously through
the API or synchronously through the CLI. An unavailable or unauthenticated
runner returns an error without creating a blocked submission. The selected
route is persisted so a retry uses the same runner. Legacy callers that omit
the route use a ready supported runner when one is available. An API caller may
explicitly store an unprepared draft with `auto_prepare=false`; that operation
does not require a ready runner unless it supplies a preparation route.
Task runner selection changes use the submission lock, expected normalization
revision, and `runner_selection_revision`. Only a route approved for the
normalized work type's execution step can be selected. Start checks the exact
route's latest readiness again before creating or running the Task.
Confirmation rechecks each repository Markdown path, digest, and pinned
revision. A stale source returns `409` with its source ID before a Mission is
created; the operator must edit the Task and add the current file again.

`markdown_sources[]` entries contain a project-relative `.md` path, a pinned
full Git revision, a SHA-256 digest, bounded byte metadata, and a sanitized
preview. Creation reads only the connected local checkout; an explicit pinned
revision must match its current `HEAD`, and AOR never fetches a remote URL. A
later read compares the current checkout revision/digest and marks the source
stale instead of silently changing the pinned snapshot.

## Carrying sources into a new submission

`POST /api/projects/:projectId/intent-submissions` may include both
`source_submission_id` and `source_ids[]` when a new submission continues an
existing Task. The source submission must belong to the same project, and each
selected ID must name an upload snapshot or repository Markdown source from
that submission. Upload bytes are copied from AOR's immutable private snapshot;
repository metadata and sanitized preview are copied without re-reading the
working-tree content; the current path and revision are checked only for
staleness. If a selected repository source is stale, creation returns `409`
and identifies that it must be removed and re-added from the current checkout.
Unknown IDs, duplicate IDs, or `source_ids[]` without
`source_submission_id` fail before a new submission is written. The new
submission records the source lineage and owns independent upload snapshots.
