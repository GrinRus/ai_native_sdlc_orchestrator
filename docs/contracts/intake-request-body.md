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

## Notes
The artifact packet owns packet identity and lifecycle status. This body owns product acceptance evidence and source-material traceability.
