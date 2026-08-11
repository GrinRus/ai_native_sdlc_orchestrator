# Intent normalization report

## Purpose

Record one deterministic validation boundary around a provider-produced task
preview without modifying the immutable operator submission.

## Required fields

- `report_id`, `submission_id`, `workspace_project_id`, `project_id`, `revision`
- `status`: `prepared`, `needs-input`, or `invalid`
- `title`, `outcome`, `constraints[]`, `acceptance[]`, `scope[]`
- `work_type`: `analyze`, `explain`, `review`, `document-change`, or `code-change`
- `delivery_mode`: `no-write` or `patch-only`
- `planned_path`: runtime-owned path descriptor with `path_id`, ordered
  `steps[]`, and a durable `reason` for any later skip decision
- `assumptions[]`, `open_questions[]`, `confidence`
- `provider`, `input_refs[]`, `validation`, `created_at`

`previous_revision_ref` is null for the first report and points to the previous
logical normalization report for every later immutable revision.

Analyze, explain, and review work must normalize to `no-write`. Document and
code changes may normalize only to `patch-only`. Preparation cannot recommend
branch, PR, upstream, or network write behavior.

`validation` records structural pass/fail and bounded-output diagnostics.
Malformed output creates an invalid report and leaves the submission retryable.
Open questions create `needs-input` and block confirmation.
The `answer` action must provide a non-empty answer for every currently open
question. Partial or empty answer maps leave the existing revision blocked and
must not clear `open_questions`.
Operator edits create a new immutable revision while preserving the provider
and route that produced the prepared preview; editing does not masquerade as a
new provider execution.
The structured provider candidate is limited to 128 KiB, 50 items per list,
200 characters for the title, 8,000 characters for the outcome, and 4,000
characters per list item before contract validation succeeds.

Provider output is accepted only when it contains the requested
`intent_normalization` candidate, one explicitly delimited JSON candidate, or
one `runner-output-envelope@v1` candidate with the requested schema. AOR never
searches arbitrary nested objects or greedy JSON substrings. Missing,
malformed, ambiguous, and unsupported candidates remain blocked and expose
bounded `validation.correction_guidance[]` entries with a field, issue code,
retryability, repair kind, and query-safe evidence refs.

## Confirmation

Confirmation compiles the latest prepared revision into the existing
`intake-request-body`. Acceptance items become deterministic pass/fail KPI and
Definition of Done entries. The UI sends `expected_revision` as a non-negative
integer CAS guard. A stale value returns HTTP `409` with code
`intent_submission.stale_revision`, the current revision in the refresh
recovery action, and no Mission/Flow mutation. The additive `confirm` action is
idempotent and creates Mission/Flow without starting a provider; the legacy
`confirm-and-start` action remains compatible and may invoke the first
Discovery action afterward.
