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
evidence-relative when it uses `evidence://`. Repository-bound fixtures resolve
from the project root when present. When the project profile selects an explicit
external evaluation registry, the same reference may resolve from that canonical
registry root; the historical leading `examples/` segment is treated as the
registry-root boundary. Resolved bytes, family, version, case identity, and
digest are recorded in the evaluation report.
