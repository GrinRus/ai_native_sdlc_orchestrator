# Discovery research report

## Purpose
Durable discovery research evidence produced by `aor discovery run` before specification handoff.
It connects repository facts, AOR-owned runtime context assets, local research inputs, open questions, and ADR-ready recommendations.

## Required fields
- `report_id`
- `project_id`
- `version`
- `generated_from`
- `repository_facts`
- `context_assets`
- `research_inputs`
- `open_questions`
- `adr_ready_recommendations`
- `completeness`
- `status`

## Status values
- `adr-ready` - repository facts, context asset refs, local research input refs, product acceptance evidence, and ADR recommendations are present.
- `incomplete` - one or more required evidence groups are missing; `open_questions` and `completeness.checks` identify the gap.

## Notes
This report does not perform autonomous web research and does not collect browser-backed citations. Local research sources must arrive through structured intake source refs or request documents.
