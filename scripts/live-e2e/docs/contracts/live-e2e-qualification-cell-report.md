# Live E2E qualification cell report

## Purpose

`live-e2e-qualification-cell-report` is the private, versioned acceptance
record for one required provider/feature-size cell. It joins terminal public
lifecycle facts without collapsing run health, transport/provider behavior,
diagnostic verification, final outcome quality, changed-path lineage, checkout
integrity, or delivery safety into one self-attested status.

Schema version `1` supports exactly four release cells:

- `openai-primary.medium`
- `openai-primary.large`
- `anthropic-primary.medium`
- `anthropic-primary.large`

OpenCode, Qwen, small, and xlarge runs may remain diagnostic evidence, but are
not implicit requirements for this matrix.

## Required shape

The report requires identity and freshness fields, seven independent
`dimensions`, four disjoint finding collections, and typed evidence entries.
Each evidence entry carries `kind`, `ref`, content `digest`, `owner`,
`generated_at`, and `run_id`.

The required dimensions are:

- `public_lifecycle`
- `run_health`
- `diagnostic_verification`
- `final_assessment`
- `changed_paths`
- `checkout_integrity`
- `delivery_safety`

Every dimension has a `status` and `evidence_refs`. A report can be `pass` only
when all seven dimensions pass and `blocking_findings` is empty. Deterministic
verification failure, timeout, wrong-run evidence, stale evidence, missing
digests, checkout drift, upstream writes, and missing or non-all-pass final
assessment all fail closed.

`observations` and `positive_evidence` never become gaps merely because they
exist. Actionable gaps belong only in `warnings` or `blocking_findings`, with a
stable `owner`, `phase`, and `class`.

## Compatibility

Readers must reject unsupported `schema_version` values. Qualification-specific
vocabulary and evidence paths remain inside `scripts/live-e2e`; product runtime
must not import or recognize this report.
