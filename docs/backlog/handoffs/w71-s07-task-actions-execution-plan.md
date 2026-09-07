# W71-S07 execution handoff

## Slice contract

W71-S07 makes Task start and subsequent primary actions server-owned. The
implementation must preserve one durable intent → Mission → Flow lineage,
return query-safe Task readback after every mutation, and dispatch published
actions from one canonical action catalog.

## UI workstream coordination

- Neighboring task: `Улучшить UI и UX`
- Thread: `01a061b2-119a-7272-91d0-13add13d75c2`
- Latest UI commit: `59943bfa` (`feat(web): align command desk target geometry`)
- Disposition: **no-overlap**. W71-S07 must not change `apps/web/**`, browser
  fixtures, generated web assets, or UI product copy.
- S14 handoff requirement: publish the action catalog, payload requirements,
  permission semantics, durable readback shape, and blocked/recovery errors in
  this repository outside the UI-owned paths.

## Implementation plan

1. Define a typed Task/Flow action catalog with payload fields, permission,
   mutation/readback behavior, and canonical lifecycle mapping.
2. Route Task mutation validation and dispatch through the catalog; remove the
   hand-maintained action allowlist and return the refreshed Task projection.
3. Harden intent start idempotency with durable start transaction metadata and
   stable identity/readback for duplicate, stale, retry, and restart paths.
4. Add contract examples and focused parity/concurrency/reload tests, then
   validate changed paths and prepare the S14 UI wiring handoff.

## Acceptance evidence

- one Start yields one Mission/Flow/run lineage and repeated/concurrent calls
  return the same durable identity;
- stale revision blocks before Mission/Flow/provider work;
- mutation responses include Task, intent/Flow/run refs, state, revision, and
  evidence refs, and remain reconstructable after a fresh process read;
- every catalog-published Task/Flow action receives a durable response or a
  typed blocking result;
- no changed file belongs to the sibling UI workstream.
