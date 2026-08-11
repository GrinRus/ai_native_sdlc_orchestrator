# W66 adversarial proof

`w66-adversarial-proof@v1` is a deterministic, query-safe report produced by
`scripts/w66-adversarial-proof.mjs`. It is the qualification freeze input for
W66-S25 and is deliberately independent of provider credentials, network
transcripts, target checkouts, and runtime state.

The proof contains:

- an expected-outcome map for missing, malformed, ambiguous, unsupported,
  partial, evidence, verification, repair-budget, and convergence failures;
- a schema-family matrix for intent normalization, structured wave tickets,
  runner final reports, repair closure, semantic evaluation, and live quality
  assessment;
- a provider-format parity matrix covering Codex stream JSON, Claude buffered
  JSON, Qwen JSONL, OpenCode JSON, and custom process JSON;
- bounded repair invariants: one active attempt, idempotent command replay,
  expected-revision CAS, exactly-once debit, disposable workspace ownership,
  mandatory review return, and no upstream write;
- historical disposition stating that all pre-S20 qualification evidence is
  diagnostic-only and cannot satisfy the post-S25 four-cell qualification.

The runner never emits raw provider output, credentials, private paths, or
runtime-local files. A pass means every negative fixture is blocked or failed,
positive output preserves the strict envelope, and all provider encodings map to
the same provider-neutral result.
