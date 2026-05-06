# Live run event

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
- `evidence.linked`
- `warning.raised`
- `run.terminal`

## Payload requirements
- `payload.sequence` is required and must increase monotonically within one `run_id`.
- `payload` should include only query-safe fields needed by CLI/web subscribers (ids, refs, status, summaries).
- For later operator troubleshooting, payloads may include `policy_context` (for example action risk tier and approval requirement flags) when the emitter has policy guardrail context.
- W18 interactive continuation events should use existing query-safe event types such as `step.updated`, `warning.raised`, and `evidence.linked` unless the contract family is intentionally expanded. Payloads should point to `requested_interaction` and answer audit evidence refs rather than embedding sensitive answer text.

## Interactive continuation payload convention
Runner-requested questions are represented as run events about a persisted `step-result.requested_interaction`, not as UI-local state.

Event payloads should use `run_id + interaction_id` when an interaction id is available and should include:
- `interaction.status` in `requested|answered|resumed|blocked`;
- `interaction.step_result_ref` or another evidence ref to the run-linked `step-result`;
- `interaction.question_summary`, sanitized for query subscribers;
- `interaction.answer_required` while the run is waiting for an operator answer;
- `interaction.answer_audit_refs` after an answer is accepted.

Recommended event use:
- `step.updated` when the interaction is requested, answered, resumed, or remains blocked;
- `evidence.linked` when answer audit evidence is written;
- `warning.raised` when validation rejects an answer or the run cannot continue.

Live streams must never include raw answer text. Subscribers should replay from the read model and treat the latest event for one `interaction_id` as the current continuation state.

## Notes
Live events should support catch-up from a read model plus the live stream.
Reconnect behavior should support replay from the last acknowledged `event_id`.
Backpressure should use a bounded replay window and avoid unbounded in-memory buffering.
