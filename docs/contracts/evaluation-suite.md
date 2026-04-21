# Evaluation suite

## Purpose
Task-specific scoring definition for a dataset, including graders, thresholds, blocking rules, and baseline policy.

## Required fields
- `suite_id`
- `version`
- `subject_type`
- `dataset_ref`
- `graders[]`
- `thresholds`

## Notes
Suites must only reference datasets with matching subject types.
Naming and scoping guidance:
- `suite_id` should be stable and purpose-oriented (for example `suite.release.short`, `suite.cert.core`).
- `version` should increment when grader logic, thresholds, or blocking rules change.
- `dataset_ref` should pin one immutable dataset version (`dataset://dataset_id@version`) rather than floating aliases.
- `subject_type` defines the target asset family and must align with the referenced dataset `subject_type`.

## Example
See `examples/eval/suite-regress-short.yaml and related suite examples`.
