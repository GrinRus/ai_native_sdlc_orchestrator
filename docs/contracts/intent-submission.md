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
- `normalization_refs[]`
- `created_at` and `updated_at`

At least one of trimmed `request_text` or `attachments[]` must be present.
Submissions are immutable except for status, normalization lineage, and
timestamps. Operator changes create a new submission or normalization revision.

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
`intake-normalize` route.
