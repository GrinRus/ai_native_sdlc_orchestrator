# Runbook: live run event stream

## Purpose
Provide operator-facing expectations for subscribing to live run events with replay-safe ordering.

## Event contract
- Use `live-run-event` contract for every streamed event.
- Supported event types:
  - `run.started`
  - `step.updated`
  - `evidence.linked`
  - `warning.raised`
  - `run.terminal`

## Replay and ordering
1. Subscribers reconnect with the last acknowledged `event_id`.
2. Stream returns replay events after that anchor, bounded by replay window.
3. Event ordering for one run follows `payload.sequence` monotonically.

## Backpressure baseline
- Keep replay window bounded (`max_replay`).
- Avoid unbounded in-memory queues.
- If consumer is too slow, prefer bounded replay on reconnect over infinite buffering.

## Operator checklist
1. Confirm stream handshake returns protocol `sse` (or equivalent stream mode).
2. Confirm replay events continue from the expected anchor `event_id`.
3. Confirm terminal run state arrives as `run.terminal`.
4. Confirm warnings are surfaced via `warning.raised` without breaking stream continuity.
