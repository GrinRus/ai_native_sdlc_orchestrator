# Incident backfill proposal

## Purpose
Reviewed proposal for turning incident and learning-loop evidence into a new dataset or suite case without mutating stable quality assets silently.

## Required fields
- `proposal_id`
- `project_id`
- `proposal_state`
- `source_artifacts`
- `target`
- `proposed_cases`
- `mutation_policy`
- `evidence_refs`
- `created_at`

## State vocabulary
`proposal_state` must be one of:
- `proposed` - ready for reviewer assessment, no dataset mutation has happened.
- `approved` - reviewed and accepted as eligible for a future dataset or suite update.
- `rejected` - reviewed and rejected; stable datasets remain unchanged.

## Source and target shape
`run_id` is optional and should mirror the first source run when the incident is run-linked.

`source_artifacts` should preserve traceability back to:
- `incident_ref`
- `learning_handoff_ref`
- `scorecard_refs`
- `run_refs`

`target` should preserve the intended quality asset scope:
- `suite_ref`
- `dataset_ref`
- `subject_type`
- `dataset_mutation_mode` (`proposal-only`)

## Proposed cases
Each entry in `proposed_cases` should include:
- `case_id`
- `source_incident_ref`
- `input_ref`
- `expected_ref`
- `linked_asset_refs`
- `route_refs`
- `context_asset_refs`
- `wrapper_refs`
- `adapter_refs`
- `compiler_revision_refs`
- `scorecard_refs`
- `harness_capture_refs`

## Mutation policy
Backfill proposal creation must not edit stable datasets. `mutation_policy` records that mutation is blocked until review accepts the proposal and a separate dataset update is performed.
