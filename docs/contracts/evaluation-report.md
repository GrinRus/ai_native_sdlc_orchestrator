# Evaluation report

## Purpose
Suite-based or grader-based report that scores a run, wrapper, route, adapter, or other supported subject.

## Required fields
- `report_id`
- `subject_ref`
- `subject_type`
- `subject_fingerprint`
- `suite_ref`
- `dataset_ref`
- `scorer_metadata`
- `grader_results`
- `summary_metrics`
- `status`
- `evidence_refs`

## Notes
Evaluation reports should preserve thresholds, regressions, and baseline comparisons.
`scorer_metadata` should describe each scorer used (`scorer_id`, mode, implementation), while
`grader_results` should keep per-scorer case outcomes.
`summary_metrics` should include at least total cases, pass/fail counts, and aggregated pass rate so
comparisons across asset versions are deterministic.

## Example
See `examples/eval/report-release-core.sample.yaml`.
