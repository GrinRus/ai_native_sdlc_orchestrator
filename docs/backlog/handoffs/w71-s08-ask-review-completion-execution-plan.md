# W71-S08 execution handoff

## Scope and coordination

- Slice: W71-S08 — Durable Ask AOR, review, and completion.
- Dependency: W71-S07 is merged and closed on `main`.
- Neighbor UI thread: `Улучшить UI` (`01a061b2-119a-7272-91d0-13add13d75c2`), latest immutable UI commit `941f26da` on `codex/command-desk-ui`.
- Coordination mode: `no-overlap`; this slice does not modify `apps/web/**` or UI-owned assets. Server-owned lifecycle, contracts, and CLI/API behavior remain the source of truth for the UI thread.

## Evidence and implementation plan

1. Make operator requests durable and resumable: persist an idempotency key, attempt, run-pending/running/completed state, and recovery action under one transaction lock. Duplicate submissions must read back the same request and completed run; stale running requests must resume with a new attempt without duplicating the identity.
2. Bind review decisions to the actual review report, Runtime Harness report, patch/diff, verification, and risk evidence. Missing, stale, mismatched, binary, or truncated evidence must fail closed and expose a recoverable next action.
3. Enforce completion prerequisites in the lifecycle and learning handoff: an approved current review, passing Runtime Harness, valid delivery/verification lineage, and a terminal run. Completed tasks are immutable; follow-up work creates a new identity.
4. Add focused recovery, replay, duplicate, stale, and completion-gate tests, then run the repository gates and inspect the final diff before PR.

## Out of scope

- UI refactor or visual changes (`apps/web/**`); consume the UI handoff as read-only coordination input.
- Multirepo scope/locking work (W71-S09) and public provision-to-integration work (W71-S10).
- Live provider/upstream writes and release publication.

## Acceptance evidence

- Ask AOR creation and execution are durable, replay-safe, and resumable.
- Review/completion decisions reference current real artifacts and fail closed on incomplete evidence.
- A completed task cannot be mutated in place; follow-up uses a new Task/Flow identity.
- Focused tests, `pnpm check`, and the W71 slice gate are green.
