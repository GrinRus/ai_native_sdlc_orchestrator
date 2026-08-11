# ADR 0022: Runner output and acceptance boundary

- Status: accepted for W66-S20 through W66-S25
- Date: 2026-08-11

## Context

An external runner can exit successfully while returning no final report,
prose, malformed or conflicting JSON, an unsupported schema, incomplete work,
or claims that contradict controller-owned evidence. The current provider work
packet asks for JSON but does not make one exact candidate schema, validation
order, ownership boundary, or failure action normative.

That ambiguity lets process completion, provider completion, parsing,
validation, verification, and mission success collapse into one apparent
success. It also makes adapter capability and historical live qualification
too broad: `structured_output: true` does not prove that one adapter/runtime
selection can satisfy every AOR schema family.

## Decision

### Strict execution boundary

A strict execution is an adapter-backed step whose result can affect a public
lifecycle, review, QA, delivery, release, promotion, or qualification verdict.
All newly emitted live and write-capable executions are strict. An explicitly
declared legacy soft mode is permitted only for immutable replay, compatibility
inspection, or deterministic dry-run evidence that cannot satisfy a new strict
qualification cell.

Before provider spawn, a strict execution must resolve exactly one versioned
candidate schema reference using the `<family>@v<integer>` form. Schema aliases
may be resolved during preparation, but the provider work packet and all later
evidence carry the resulting exact reference.

### Normalized runner output

Every adapter maps provider-native output into
`runner-output-envelope@v1`. The query-safe envelope contains:

- the exact requested schema ref;
- `parse_status` in `valid|missing|malformed|ambiguous|unsupported`;
- zero or one candidate;
- bounded normalized issues;
- one raw-output evidence ref plus byte-count and digest metadata;
- independent process, transport, and provider outcome summaries.

Only `parse_status=valid` permits the candidate to enter schema validation.
Missing or malformed output has no candidate. Ambiguous output never selects a
preferred object. Unsupported output may retain only bounded issue metadata;
the unsupported payload remains raw evidence.

The canonical JSON encoding of a query-safe candidate is limited to 65,536
UTF-8 bytes. The envelope carries at most 64 normalized issues; each issue
summary is limited to 1,024 Unicode code points and each field path to 256 code
points. Exceeding any bound is a structural schema failure. Full provider
stdout, JSONL, transcripts, prompts, credentials, tool arguments/results, and
runner-home paths never appear inline in query-safe contracts.

### Candidate and authoritative report ownership

The model-authored `runner-final-report@v1` candidate may state only
`completed|partial|blocked`, a bounded summary, changed-file claims,
required-command result claims, verification claims, risks, and optional
repair-closure claims. AOR owns all public IDs, run/step/attempt identity,
timestamps, evidence verification, validation status, aggregate status, and
mission verdict when materializing a durable report.

Outcome dimensions remain independent:

| Dimension | Owner | Meaning |
|---|---|---|
| Process | controller | spawn, exit code, signal, timeout, cancellation |
| Transport | adapter | request delivery and stream/buffer completion |
| Provider | adapter | provider terminal, auth, permission, or runtime outcome |
| Parsing | adapter | candidate presence and syntactic selection |
| Candidate | model | `completed`, `partial`, or `blocked` claim |
| Validation | AOR validator registry | schema and evidence acceptance |
| Verification | controller | authoritative command results |
| Mission | Runtime Harness | pass, repair, escalate, block, or fail |

No earlier dimension can imply success in a later dimension.

### Provider work packet v3 and command identity

New strict execution emits `aor-provider-work-packet` version 3. Its
`output_contract` contains the exact schema ref, the 65,536-byte candidate
bound, exactly-one-candidate rule, required sections, allowed candidate
statuses, and the required command IDs that the candidate may reference.

AOR assigns each required command an ID in the form
`required-command.<ordinal>.<digest12>`. The digest is derived from the
environment-qualified command record: normalized command, role, logical
working-directory ref, enforcement, timeout class, and non-secret environment
identity. It is not derived from provider output. IDs are unique within the
packet, map one-to-one to ordered required commands, and change when the
qualified command identity changes.

Versions 1 and 2 remain immutable and loadable. They are never rewritten in
place, are not emitted by strict execution, and cannot satisfy qualification
under the v3 acceptance policy.

### Validation order and failure policy

Strict post-validation runs in this order:

1. `output-schema`;
2. `evidence-complete`;
3. `validation-commands`;
4. semantic evaluation, only after structural validation passes.

Unknown, duplicate, or incompatible validators block before provider spawn.
The canonical initial action mapping is:

| Failure kind | Failure class | Default action |
|---|---|---|
| `runner-output-missing` | `schema-mismatch` | one bounded no-write output-contract repair when policy permits, otherwise block |
| `runner-output-malformed` | `schema-mismatch` | one bounded no-write output-contract repair when policy permits, otherwise block |
| `runner-output-ambiguous` | `schema-mismatch` | one bounded no-write output-contract repair when policy permits, otherwise block |
| `runner-output-unsupported` | `schema-mismatch` | block before spawn when capability mismatch is known; otherwise block the result |
| `runner-output-partial` | `incomplete-result` | work-product review/repair, never format repair |
| `runner-output-missing-evidence` | `missing-evidence` | no-write evidence reconciliation only when controller-owned facts exist, otherwise block |
| `runner-output-missing-verification` | `verification-missing` | reconcile existing controller evidence or block; never accept a model claim |
| `runner-output-verification-contradiction` | `validation-commands-failed` | fail closed and enter policy-owned work-product repair/review |

Every failure kind maps to exactly one policy class. Unknown kinds fail closed
and receive no implicit retry, fallback, or repair action.

Output-contract repair, evidence reconciliation, and work-product repair are
separate policy actions and budgets. The first two are no-write. Only
work-product repair may edit the owned disposable workspace and must return
through review and QA.

### Schema capability and qualification

Strict adapter capability is keyed by:

- adapter identity and digest;
- provider/runtime identity;
- requested/effective model and reasoning effort when explicit;
- native output mode;
- exact candidate schema ref;
- immutable qualification evidence ref.

`structured_output: true` is legacy compatibility metadata only. It does not
qualify a strict route. Qualification has no time-only expiry; it becomes stale
when any keyed behavior input changes. Historical evidence remains factual but
cannot qualify the changed combination.

## Consequences

- A zero exit code can coexist with rejected parsing, validation, verification,
  or mission outcomes without contradiction.
- Provider-native event names and extraction rules stay inside adapters.
- Runtime Harness and policy code consume stable runner-neutral failure classes.
- Raw provider output remains inspectable through evidence without entering
  ordinary CLI/API/web projections.
- W66-S20 owns the contracts and compatibility fixtures; W66-S21 owns native
  extraction and acceptance; W66-S22 owns validator execution and bounded
  output/evidence repair; W66-S23 owns public work-product retry; W66-S24 owns
  structured consumers; W66-S25 owns adversarial proof and qualification reset.

## Follow-up

W66-S20 must materialize these decisions in contract docs, examples, loaders,
reference rules, provider work-packet v3, adapter capability validation, and
public/private contract-kernel parity without adding provider calls. Later
slices must preserve this ownership and may change a decision only through a
new contract version and explicit compatibility evidence.
