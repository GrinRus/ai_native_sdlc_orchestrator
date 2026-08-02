# Evaluation case expected result

## Purpose

Immutable, versioned deterministic assertions for one evaluation case.

## Required fields

- `family` (`evaluation-case-expected`)
- `case_id`
- `version`
- `subject_type`
- `assertions[]`

Each assertion contains an `assertion_id`, a `target` (`subject` or `input`), an
RFC 6901 JSON Pointer `path`, and one operator: `equals`, `contains`, `exists`,
or `absent`. `equals` and `contains` require `value`; `exists` and `absent` do
not. A case is bounded to 100 assertions and JSON Pointer depth 64.

