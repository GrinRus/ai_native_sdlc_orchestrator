# W71-S10 execution handoff

## Scope and UI coordination

- Slice: `W71-S10` — public workspace provision-to-integration lifecycle.
- UI thread: `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`).
- Latest UI evidence checked before implementation: commit `941f26da`
  (`feat(web): align command desk target geometry`), with the UI thread marked
  complete after browser, responsive, keyboard, console, and web validation.
- Coordination mode: `no-overlap`; this slice does not edit `apps/web/**` or
  UI-owned screenshots/assets. The public control-plane response remains
  server-owned so the UI thread can consume it without a parallel lifecycle.

## Contract-first plan

1. Derive repository inputs from the registered project profile and local
   binding state, then expose one bounded `workspace provision` CLI command.
   Provisioning must validate project/run/workspace identities, reject dirty or
   unavailable repositories, support `--dry-run`, and persist a contract-valid
   schema-v2 workspace-set report only after every checkout reaches the exact
   requested commit.
2. Add the matching public API action on the existing project action boundary
   and update the OpenAPI request enum/response description. Keep the API and
   CLI on the same core service; no transport imports another transport.
3. Extend parent start with an explicit provision-to-schedule path and make
   integration application idempotent under duplicate/restart/stale CAS input.
   Preserve parent, task, unit, attempt, and workspace lineage; never fall back
   to a primary checkout or silently apply partial integration.
4. Add focused parity and adversarial tests for monorepo/multirepo, dirty and
   invalid bindings, overlapping writable scopes, partial provisioning cleanup,
   duplicate/restart/retry, and aggregate closure blocking. Add an installed
   two-repository black-box journal using public command/API surfaces and
   deterministic adapters, with no upstream writes.
5. Run focused tests plus `pnpm slice:gate` and the repository gate. Review the
   diff for contract drift and UI overlap before branch/PR closure.

## Acceptance evidence

- Public CLI/API calls create/read a workspace set without handcrafted
  workspace reports or private imports.
- Structured parent execution reaches authoritative integration exactly once;
  retries/restarts are idempotent and retain all lineage identities.
- Invalid path, digest, verification, or partial repository outcomes block the
  aggregate and leave source checkouts unchanged.
- Provision, child attempts, contention, retry, integration, aggregate
  delivery/readback, cleanup, and no-upstream-write evidence are journaled.
