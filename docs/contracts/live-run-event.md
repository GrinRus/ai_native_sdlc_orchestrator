# Live run event

## Purpose
Normalized event emitted during workflow execution for CLI, API, and web subscribers.

## Required fields
- `event_id`
- `run_id`
- `timestamp`
- `event_type`
- `payload`

## Notes
Live events should support catch-up from a read model plus the live stream.
