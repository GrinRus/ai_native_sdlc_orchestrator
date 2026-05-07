# Artifact packet

## Purpose
Generic packet for discovery, research, ADR, spec, review summary, and other artifact-oriented lifecycle stages.

## Required fields
- `packet_id`
- `project_id`
- `packet_type`
- `version`
- `status`
- `summary`
- `body_ref`

## Notes
Artifact packets should be human-readable and machine-linkable. They are the default durable unit for non-execution stages.

When `packet_type` is `intake-request`, `body_ref` points to an `intake-request-body` document. The packet carries lifecycle identity; the body carries product goals, constraints, KPIs, Definition of Done, local source references, and completeness evidence.
