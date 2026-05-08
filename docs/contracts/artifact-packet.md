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

## Loader validation
The shared contract loader validates the required packet identity fields and the optional nested fields used by runtime writers:
- `evidence_refs[]` must contain strings when present.
- `invocation_context` must be an object when present and must preserve `command`, `project_root`, and `project_profile_ref`.
- `invocation_context.mission_id` is validated as a string or `null` when present; legacy/runtime packets may omit it when the packet is not mission-scoped yet.
