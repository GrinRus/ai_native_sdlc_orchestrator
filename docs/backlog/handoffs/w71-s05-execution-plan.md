# W71-S05 execution plan — atomic intent and runtime state transactions

## Task contract

- **Outcome:** shared mutable intent, run, and provider status state is updated
  by one lock-scoped, revision-aware transaction owner. Preparation is
  idempotent, concurrent callers cannot duplicate provider work, and
  corruption or persistence failures remain explicit recovery evidence.
- **In scope:** the observability file-transaction primitive, intent
  preparation ownership, run-control provider status writes, focused race and
  fault-injection tests, and a source-level direct-write ownership ratchet.
- **Out of scope:** UI layout/components, multirepo semantics, distributed
  storage, provider-specific routing, and changes to `apps/web/**`.
- **Acceptance:** no duplicate preparation work or revision overwrite under
  contention; heartbeat/final status never rolls back operator controls;
  corrupt state blocks or enters explicit recovery rather than becoming an
  empty object; repeated contention reports zero lost transitions.

## UI coordination

The neighboring UI task **“Улучшить UI и UX”** is complete. Its immutable
baseline is the `codex/command-desk-ui` workstream (latest handoff commit
`59943bfa`, with the UI proof recorded in that task). The UI changes are already
integrated into `origin/main`. This slice records **`no-overlap`**: server-owned
lifecycle, state contracts, and persistence behavior remain the source of
truth; no files under `apps/web/**` will be edited. W71-S14 may consume this
baseline for final integration only.

## Implementation plan

1. **Contract and primitive.** Add a documented state-transaction contract
   covering lock scope, revision/fencing, atomic rename, corruption quarantine,
   and idempotency. Extend the shared observability helper with strict reads,
   quarantine metadata, and lock-scoped read/modify/write transactions while
   preserving existing callers.
2. **Intent preparation owner.** Guard the full preparation attempt with a
   submission lock, stable attempt/idempotency identity, strict state loading,
   stale `preparing` recovery, and reuse of an already prepared report. A
   provider failure persists a blocked state and never silently resets the
   submission.
3. **Provider status owner.** Reuse the run-control per-run lock for heartbeat
   and terminal provider status updates. The helper must merge only
   provider-owned fields, preserve action sequence and operator controls, and
   surface corrupt/persistence failures.
4. **Adoption ratchet.** Add an explicit direct-write exception manifest with
   owner and expiry, migrate the affected writers, and add a deterministic
   source check that rejects unowned shared-state direct writes.
5. **Evidence and gate.** Add unit, multi-process, race, crash-boundary, and
   corruption tests; run focused checks, `pnpm slice:gate`, review the diff,
   and record evidence before closing the slice.

## Verification commands

```text
node --test packages/observability/test/file-transaction.test.mjs
node --test packages/orchestrator-core/test/intent-service.test.mjs packages/orchestrator-core/test/run-control.test.mjs
node scripts/contract-kernel-parity.mjs
pnpm slice:gate
```
