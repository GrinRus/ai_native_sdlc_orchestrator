# W71-S06 execution plan — contract closure and evidence resolution

## Task contract

- Outcome: reject runtime-invalid delivery, release, integration, and path-scope
  artifacts before they can assert success; make evidence references resolvable,
  immutable, and bound to the owning run.
- Scope: `packages/contracts/**`, canonical path/reference utilities,
  `packages/orchestrator-core/src/aor-home.mjs` and delivery/integration
  producers, contract docs/examples/tests, and W71 backlog evidence.
- Excluded: `apps/web/**` and visual/UI implementation.
- Neighbor coordination: the `Улучшить UI` task is complete at commit
  `59943bfa` (PRs #296/#297). Coordination decision: `no-overlap`; this slice
  must not modify or duplicate UI work. Any future UI dependency is a
  `contract-handoff` after this slice, not a merge prerequisite.

## Acceptance criteria

1. Delivery-plan, delivery-manifest, release-packet, and integration-report
   validators enforce closed status vocabularies, nested shape, and
   cross-field success/blocked invariants with stable issue codes.
2. Packet identities (project/run/task/unit/attempt/repository) and digests are
   checked consistently; mismatches fail closed.
3. Canonical path scopes normalize deterministically, compare exact changed paths,
   and expose segment-aware overlap checks with positive and negative tests.
4. Evidence references resolve only inside the owning AOR runtime root, reject
   traversal/symlink escape, and verify immutable byte identity plus lineage
   bindings through one shared resolver used by delivery/integration paths.
5. Canonical examples remain valid, adversarial mutations fail for the intended
   reason, and parity/quality/slice gates pass.

## Implementation plan

1. Extend the contract-family registry with closed status enums and dispatch
   specialized validators from the shared loader.
2. Implement nested validators for delivery, release, and integration packets;
   add identity, digest, status, lineage, and partial-transaction invariants.
3. Add segment-aware scope normalization/overlap helpers and document the
   canonical grammar and exact changed-path rule.
4. Add a shared evidence resolver/store with containment, symlink, digest, and
   binding checks; migrate delivery-plan evidence locking and integration
   authority reads to it while preserving legacy URI compatibility.
5. Add contract, resolver, and producer regression tests plus canonical and
   adversarial fixtures; update contract index/docs and run the repository gates.

## Verification

- `node --test packages/contracts/test/contracts-loader.test.mjs`
- focused orchestrator delivery/integration tests
- `pnpm quality:ratchet`
- `node scripts/contract-kernel-parity.mjs`
- `pnpm slice:gate` (CI Node 22 is authoritative if local Node 25 resource
  limits reproduce the previously documented cancellation timeout)

