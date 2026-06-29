# Live E2E scenario policy

## Purpose
Machine-readable internal policy document that defines required stages, evidence, and closure expectations for one live E2E scenario family.

## Required fields
- `scenario_family`
- `required_stages`
- `required_evidence`
- `delivery_mode_policy`
- `release_required`
- `incident_policy`
- `governance_policy`

## Supported scenario families
- `regress`
- `release`
- `repair`
- `governance`

## Notes
- Scenario policies are used by the installed-user Live E2E proof runner and runner skill to validate curated matrix cells before execution starts.
- Live E2E validates proof coverage and the presence of Runtime Harness evidence. It does not define internal Runtime Harness repair semantics.
- `release_required=true` means the selected profile must materialize release lineage through the public CLI flow.
