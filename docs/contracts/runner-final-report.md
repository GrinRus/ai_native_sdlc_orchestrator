# Runner final-report candidate

## Purpose

`runner-final-report@v1` is the minimal model-authored candidate accepted by a
strict runner-output envelope. It describes what the runner attempted and
observed; it does not own AOR identity, evidence, validation, or aggregate
outcome fields.

## Required shape

- `status`: `completed`, `partial`, or `blocked`.
- `summary`: bounded human-readable summary.
- `changed_files`: repository-relative changed paths claimed by the runner.
- `command_result_claims`: bounded claims about commands the runner reports.
- `verification`: runner observations that AOR must reconcile with
  controller-owned verification.
- `risks`: bounded risk summaries.
- `repair_closure`: optional bounded repair observations, or `null`.

The candidate must not contain `public_ids`, `report_id`, `run_id`, `step_id`,
timestamps, authoritative `evidence_refs`, `validation_status`, aggregate
pass/fail status, qualification verdicts, credentials, transcripts, or local
runner-home paths. AOR adds public identity, timestamps, verified evidence
refs, validation reports, and the authoritative aggregate status when it
materializes a durable report.

## Compatibility

The candidate is independent of provider format. Native JSON, buffered JSON,
stream JSON, and JSONL terminal events are adapter concerns. A strict route
must resolve this exact candidate schema before provider spawn.
