# Intake request body

## Purpose
Body document referenced by an `artifact-packet` whose `packet_type` is `intake-request`.
It preserves the product-intake evidence that later discovery, planning, review, and delivery gates trace back to.

## Required fields
- `generated_from`
- `project_identity`
- `mission_traceability`
- `product_intake`
- `product_intake_completeness`
- `mission_scope`
- `feature_request`
- `evidence_roots`

## Product intake fields
`product_intake` must contain:
- `goals` - product goals or intended outcomes.
- `constraints` - product, technical, policy, scope, budget, or timing constraints.
- `kpis` - acceptance metrics with `kpi_id`, `name`, `target`, and optional `measurement`.
- `definition_of_done` - checklist items that define product acceptance for the request.
- `source_refs` - local structured source references.

Supported `source_refs[].source_kind` values are:
- `local-issue`
- `local-prd`
- `local-rfc`
- `local-note`
- `local-mail`

External SaaS ingestion such as live Jira, GitHub Issues, Gmail, or Outlook connectors is out of scope for this contract. Such sources must be represented only after they have been exported or mirrored into a local structured source reference.

`product_intake_completeness.status` is `complete` when goals, constraints, KPIs, Definition of Done, and source refs are present; otherwise it is `incomplete` and `missing_fields` names the absent evidence groups.

## Mission scope fields
`mission_scope` records delivery and write-back intent used by guided next-action resolution:
- `delivery_mode` - one of `no-write`, `patch-only`, `local-branch`, or `fork-first-pr`.
- `writeback_policy` - explicit write-back defaults. `upstream_writes_default` must remain false for installed-user guided flows, and delivery-capable modes require review before write-back.

`allowed_paths` and `forbidden_paths` are project-relative authorization hints
and follow `canonical-identifiers-and-paths.md`. Absence, `[]`, bounded patterns,
and explicit unrestricted scope are distinct. Malformed values fail contract
validation. These fields bound filesystem authorization; they do not replace
Runtime Harness product acceptance, which remains expressed through goals,
constraints, KPIs, Definition of Done, expected evidence, and verification
commands.

## Notes
The artifact packet owns packet identity and lifecycle status. This body owns product acceptance evidence and source-material traceability.

Guided mission intake in W21 must populate these same product-intake fields instead of creating a parallel mission schema. Missing goals, constraints, KPIs, Definition of Done, or source refs should remain explicit through `product_intake_completeness` so `aor next` and guided web stages can report blockers deterministically. Delivery mode is an execution boundary, not a product acceptance substitute.

W34 flow creation reuses this contract. `New Flow` and follow-up flow creation
must write a fresh intake-request body rather than editing a completed flow's
intake evidence. Follow-up lineage may be recorded in
`mission_traceability.coverage_follow_up.follow_up_source_handoff_ref` by the
runtime-owned `mission create --follow-up-source-handoff-ref <ref>` path, and is
then projected through the control-plane `follow_up_source_handoff_ref` field.
The body still owns only the new flow's product acceptance evidence.
