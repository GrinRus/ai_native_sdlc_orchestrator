# Dataset

## Purpose
Versioned collection of cases for one subject type such as run, wrapper, route, or adapter.

## Required fields
- `dataset_id`
- `version`
- `subject_type`
- `provenance`
- `cases[]`

## Notes
Datasets should carry provenance, splits or tags, and flake policy.
Naming and scoping guidance:
- `dataset_id` should be stable, kebab-case, and scoped by domain intent (for example `run-regression`, `wrapper-certification`).
- `subject_type` should map to the target asset family (`run`, `wrapper`, `route`, or `adapter`).
- `version` should be immutable and monotonically increasing (timestamp or semantic version) so suites can pin deterministic snapshots.

## Example
See `examples/eval/dataset-run-regression.yaml and examples/eval/dataset-wrapper-certification.yaml`.
