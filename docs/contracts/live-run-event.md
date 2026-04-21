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

## Notes
Live events should support catch-up from a read model plus the live stream.
Reconnect behavior should support replay from the last acknowledged `event_id`.
Backpressure should use a bounded replay window and avoid unbounded in-memory buffering.
