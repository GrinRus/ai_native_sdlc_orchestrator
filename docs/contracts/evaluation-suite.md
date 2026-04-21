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

## Example
See `examples/eval/suite-regress-short.yaml and related suite examples`.
