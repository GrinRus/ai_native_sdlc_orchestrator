# W71-S04 execution handoff

## Coordination

- UI owner: sibling task `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`).
- Immutable UI handoff currently ends at `59943bfa` on `codex/command-desk-ui`.
- Disposition: `no-overlap`. This slice does not edit `apps/web/**`, browser
  fixtures, or UI-owned product assets. It publishes additive server fields and
  a projection fixture for the sibling task to consume later.

## Work plan

1. Define a versioned `task-projection` contract with a closed Task status
   vocabulary, stable identity/lineage, prepared execution payload, and explicit
   write effects. Add positive, negative, and legacy migration fixtures.
2. Make the runtime projection populate the prepared payload from normalized
   intent plus the approved execution profile. Intake-normalization provider
   metadata remains provenance only and is never copied into `approved_route`.
3. Close provider-route step values and Task action/runner status values at the
   shared contract boundary. Keep `start` as the only Task start mutation and
   forward the displayed revision as the CAS guard from HTTP and CLI.
4. Align OpenAPI, command catalog, examples, and contract/reference tests; keep
   all UI changes deferred to the sibling handoff.

## Acceptance and verification

- Prepared projections expose outcome, acceptance, scope, delivery mode,
  normalization revision, approved route, readiness revision, and write effects.
- A `route.intake-normalize.*` value can never be an approved execution route.
- `start` is canonical and rejects stale revisions before Flow creation/start.
- `pnpm test:references`, focused contract/projection/API/CLI tests,
  `node scripts/contract-kernel-parity.mjs`, and `pnpm slice:gate` pass.
