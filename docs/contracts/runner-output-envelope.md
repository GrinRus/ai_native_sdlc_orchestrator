# Runner output envelope

## Purpose

`runner-output-envelope@v1` is the provider-neutral handoff between an
adapter's native stream parser and deterministic AOR validation. The envelope
is query-safe and never makes process or transport success equivalent to an
accepted mission result.

## Required shape

- `schema_version`: `1`.
- `requested_schema_ref`: exactly one candidate family in
  `<family>@v<integer>` form, for example `runner-final-report@v1`.
- `parse_status`: one of `valid`, `missing`, `malformed`, `ambiguous`, or
  `unsupported`.
- `candidate`: one object when `parse_status=valid`; `null` for every other
  parse status. Arrays and multiple candidates are never accepted.
- `normalized_issues`: zero or more bounded issue records, with a maximum of
  64 entries.
- `raw_evidence_ref`: an `evidence://` reference to the immutable provider
  output; raw output is evidence-only and is not query-safe content.
- `query_safe`: `true`.

The UTF-8 encoded JSON representation of `candidate` is limited to 65,536
bytes. Issues must contain only bounded summaries, field paths, evidence refs,
and the runner-neutral failure vocabulary below.

## Failure taxonomy

| Detailed `failure_kind` | Policy-facing `failure_class` | Default meaning |
| --- | --- | --- |
| `runner-output-missing` | `schema-mismatch` | No candidate was emitted. |
| `runner-output-malformed` | `schema-mismatch` | Output could not be parsed. |
| `runner-output-ambiguous` | `schema-mismatch` | More than one candidate or terminal result was found. |
| `runner-output-unsupported` | `schema-mismatch` | Candidate schema or output mode is not supported. |
| `runner-result-partial` | `incomplete-result` | The runner explicitly reports incomplete work. |
| `runner-evidence-missing` | `missing-evidence` | Required controller-owned evidence is absent. |
| `runner-verification-missing` | `verification-missing` | Required verification evidence is absent. |
| `runner-verification-contradiction` | `verification-contradiction` | Model claims conflict with controller results. |
| `runner-validation-command-failed` | `validation-commands-failed` | A required validation command failed or timed out. |

Every detailed kind maps to exactly one class. Unknown kinds fail closed and
must not inherit a broad repair action. Retry, output repair, evidence
reconciliation, work-product repair, escalation, and block decisions remain
policy-owned consumers of these classes.

## Query-safe boundary

The envelope and its issues must not contain prompts, credentials, tool
arguments, transcripts, environment values, provider home directories, or
local runner state paths. Those values remain behind `raw_evidence_ref` and
are never copied into public projections.
