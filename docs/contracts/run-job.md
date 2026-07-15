# Run job

## Purpose

`run-job` is the durable ownership record for asynchronous local run execution.
The accepting CLI/API process reserves the job and run identity, persists this
record, starts a separate Node worker, and returns without waiting for provider
completion.

## Required fields

- `schema_version`, `job_id`, `run_id`, and `project_id`;
- `status` in `queued|running|paused|waiting-input|canceling|succeeded|failed|canceled`;
- non-negative monotonic `revision`;
- `accepted_at`, `status_ref`, and `event_ref`.

## Worker and lifecycle fields

- `worker` is null before ownership or contains a stable worker identity and PID;
- `heartbeat_at` is refreshed while the worker supervises the provider process;
- `started_at` records the first running transition;
- terminal states require `terminal_at` and `terminal_evidence_refs[]`;
- `waiting-input` is non-terminal and preserves the run for an audited answer;
- `canceling` requests bounded process-group termination before `canceled`.

Updates use the project runtime lock and compare the expected revision before an
atomic replace. Reusing one run/job identity with a different request digest is
a typed conflict. Job state, run-control state, and live-event JSONL remain
separate durable records joined by `run_id`.

## Cursor semantics

`event_ref` points to the durable JSONL journal. `maxReplay=0` returns no replay;
positive values are capped by the server maximum. Reconnect resumes after
`after_event_id`. Live delivery tails the journal across processes and never
uses a process-local emitter as the source of truth.
