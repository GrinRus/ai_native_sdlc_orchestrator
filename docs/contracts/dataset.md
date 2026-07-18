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
Governance rehearsal datasets should stay scoped to run-level governance evidence such as policy gates,
no-upstream-write delivery posture, and delivery manifest completeness.
Naming and scoping guidance:
- `dataset_id` should be stable, kebab-case, and scoped by domain intent (for example `run-regression`, `wrapper-certification`).
- `subject_type` should map to the target asset family (`run`, `wrapper`, `route`, or `adapter`).
- `version` should be immutable and monotonically increasing (timestamp or semantic version) so suites can pin deterministic snapshots.
- incident-driven additions should start as `incident-backfill-proposal` artifacts; stable dataset files are updated only after reviewer approval and a separate dataset revision.
- every case pins immutable `evaluation-case-input` and
  `evaluation-case-expected` artifacts. Relative POSIX refs are resolved from
  the project root, or from the canonical explicit evaluation registry root
  when the project does not materialize those fixtures. `evidence://` refs are
  resolved from the owning project runtime. Missing, cross-project, stale, or
  wrong-family artifacts fail closed.

## Example
See `examples/eval/dataset-run-regression.yaml`,
`examples/eval/dataset-governance-integration.yaml`, and
`examples/eval/dataset-wrapper-certification.yaml`.
