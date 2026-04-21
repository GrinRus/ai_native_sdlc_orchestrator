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

## Example
See `examples/eval/dataset-run-regression.yaml and examples/eval/dataset-wrapper-certification.yaml`.
