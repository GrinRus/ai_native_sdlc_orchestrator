# Provider work packet v3

## Purpose

`provider-work-packet@v3` is the strict provider-facing contract for a new
live or write-capable adapter-backed step. It tells the runner which exact
candidate schema, output mode, required sections, output bound, and
AOR-owned command identities must be returned.

## Compatibility

Packet v1 and v2 remain readable immutable replay evidence. They are not
eligible for new strict qualification and are not rewritten in place. Runtime
emission of v3 is implemented by the W66-S21 adapter normalization slice; until
a route declares strict output, v1/v2 remain replay-readable compatibility
surfaces only.

## `output_contract`

The packet's `output_contract` must contain:

- `schema_ref`: one exact candidate ref such as `runner-final-report@v1`;
- `output_mode`: `structured-json`, `stream-json`, or `jsonl-terminal-event`;
- `candidate_rule`: exactly `exactly-one-candidate`;
- `required_sections`: unique section names required by the candidate schema;
- `status_vocabulary`: the complete allowed candidate status set;
- `max_candidate_bytes`: `65536`;
- `required_commands`: unique objects with AOR-owned `command_id` and the
  corresponding command string.

Command IDs are environment-qualified AOR identities and use the form
`aor.command.<environment>.<stable-name>`. They are not model-authored and
must map one-to-one to controller-owned command results.

## Ownership and validation order

Process, transport, provider, parsing, candidate, validation, verification,
and mission outcomes remain independent fields. Structural validators execute
in the fixed order `output-schema`, `evidence-complete`, and
`validation-commands` before semantic evaluation. A provider transport success
cannot satisfy any later outcome by itself.
