# Live run event

`event_id` and `run_id` use the canonical public-ID grammar in
`canonical-identifiers-and-paths.md`. Event identity is data, not a path or SSE
field; CR/LF, separators, traversal, and normalization-derived values are
rejected.

## Purpose
Normalized event emitted during workflow execution for CLI, API, and web subscribers.

## Required fields
- `event_id`
- `run_id`
- `timestamp`
- `event_type`
- `payload`

## Event types
`event_type` must be one of:
- `run.started`
- `step.updated`
- `provider.heartbeat`
- `evidence.linked`
- `warning.raised`
- `run.terminal`

## Payload requirements
- `payload.sequence` is required and must increase monotonically within one `run_id`.
- `payload` should include only query-safe fields needed by CLI/web subscribers (ids, refs, status, summaries).
- For later operator troubleshooting, payloads may include `policy_context` (for example action risk tier and approval requirement flags) when the emitter has policy guardrail context.
- `provider.heartbeat` payloads may include `provider_step_status`, using the same
  public heartbeat shape as control-plane project state and run summaries. These
  payloads must keep provider progress summarized and must not include raw
  process commands, command args, prompts, file contents, environment values,
  bearer tokens, auth tokens, or provider secrets.
- W18 interactive continuation events should use existing query-safe event types such as `step.updated`, `warning.raised`, and `evidence.linked` unless the contract family is intentionally expanded. Payloads should point to `requested_interaction` and answer audit evidence refs rather than embedding sensitive answer text.
- W20 production hardening requires event emitters and stream presenters to apply the configured redaction policy before JSONL append or SSE replay. Configured bearer tokens and explicit redaction values must not appear in live-event logs or stream payloads.

## Interactive continuation payload convention
Runner-requested questions are represented as run events about a persisted `step-result.requested_interaction`, not as UI-local state.

Event payloads should use `run_id + interaction_id` when an interaction id is available and should include:
- `interaction.status` in `requested|answered|resumed|blocked`;
- `interaction.step_result_ref` or another evidence ref to the run-linked `step-result`;
- `interaction.question_summary`, sanitized for query subscribers;
- `interaction.answer_required` while the run is waiting for an operator answer;
- `interaction.answer_audit_refs` after an answer is accepted.
- `interaction.continuation.next_action` when the event is reporting a deterministic resume/block decision.

Recommended event use:
- `step.updated` when the interaction is requested, answered, resumed, or remains blocked;
- `evidence.linked` when answer audit evidence is written;
- `warning.raised` when validation rejects an answer or the run cannot continue.

Live streams must never include raw answer text. Subscribers should replay from the read model and treat the latest event for one `interaction_id` as the current continuation state.

## Loader validation
The shared contract loader validates the query-safe nested event surface:
- `payload.sequence` is required and must be numeric;
- `payload.interaction.status` must use `requested|answered|resumed|blocked` when an interaction payload is present;
- `payload.interaction.answer_audit_refs[]` must contain strings when present;
- `payload.interaction.continuation.next_action` must be a string when continuation metadata is present;
- raw answer fields such as `answer`, `answer_text`, and `raw_answer` are rejected in `payload` and `payload.interaction`.

## Notes
Live events should support catch-up from a read model plus the live stream.
Reconnect behavior should support replay from the last acknowledged `event_id`.
Backpressure should use a bounded replay window and avoid unbounded in-memory buffering.
