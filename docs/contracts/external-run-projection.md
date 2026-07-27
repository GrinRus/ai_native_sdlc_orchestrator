# External run projection

## Purpose

`external-run-projection` is the generic public ingress contract for a
controller that executes outside the selected project runtime. The controller
materializes a compact projection in the selected project's normal reports
directory. Product read models consume only this contract and do not infer a
private runner, filename family, or workspace topology.

## Required fields

- `schema_version`: currently `1`.
- `projection_id`, `run_id`, `status`, and `generated_at`.
- `pending_steps[]`, `completed_steps[]`,
  `missing_operator_decision_steps[]`, and `missing_evidence_refs[]`.
- `blockers[]` and query-safe `artifact_display_summaries[]`.
- `evidence_refs[]` containing canonical public references rather than local
  private-runner paths.

Optional fields carry the compact profile, current-step, failure, pending
decision, resume, and controller summaries already exposed by the control-plane
API. Producers must omit prompts, raw commands, credentials, environment
values, private filenames, and workspace layout.

## Validation and compatibility

Version 1 is additive. Unknown optional fields may be ignored, while missing
required identity, status, list, or evidence fields fail validation. Consumers
discover `external-run-projection-*.json` only inside the selected project's
canonical reports directory.
