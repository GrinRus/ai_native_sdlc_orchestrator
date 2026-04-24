# Live E2E target catalog

## Purpose
Machine-readable internal catalog document that binds one curated repository to its live E2E missions, required matrix cells, and provider comparison expectations.

## Required fields
- `catalog_id`
- `repo`
- `verification`
- `safety_defaults`
- `required_matrix_cells`
- `provider_comparison_pairs`
- `feature_missions`

## Feature mission expectations
Each mission should carry:
- `mission_id`
- `title`
- `brief`
- `feature_size`
- `supported_scenarios`
- `recommended_provider_variants`
- `allowed_paths`
- `forbidden_paths`
- `expected_evidence`
- `acceptance_checks`
- `size_budget`
- `size_rationale`

## Notes
- The catalog is curated, not cartesian-complete.
- Every curated repo should expose at least one `small`, one `medium`, and one `large` mission.
- Required matrix cells are the canonical acceptance subset for that repo.
