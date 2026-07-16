# Evaluation case input

## Purpose

Immutable, versioned input content consumed by deterministic or injected judge
scorers for one evaluation case.

## Required fields

- `family` (`evaluation-case-input`)
- `case_id`
- `version`
- `subject_type`
- `content`

The dataset reference is repository-bound when it is a relative POSIX path and
evidence-relative when it uses `evidence://`. Resolved bytes, family, version,
case identity, and digest are recorded in the evaluation report.

