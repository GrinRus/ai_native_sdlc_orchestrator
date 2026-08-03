# Evidence export manifest

## Purpose

Describe one explicit, reviewable copy of selected AOR evidence into a
connected repository without exporting the complete runtime.

## Required fields

- `export_id`, `workspace_project_id`, `project_id`, and optional `flow_id`
- `destination`
- `entries[]`
- `excluded_categories[]`
- `created_at`

Each entry requires a logical `source_ref`, project-relative `exported_path`,
`sha256`, `byte_length`, and artifact `family`. The destination must remain
under `.aor/exports/<flow-id>/<export-id>/`.

Raw provider logs, credentials, environment data, intent attachment bodies,
managed checkouts, and unselected runtime files are forbidden. Export uses
staging plus atomic rename, never overwrites an existing export ID, and never
stages, commits, or pushes Git changes.
