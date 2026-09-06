# W71-S09 execution plan — canonical scope locks and isolated integration

## Coordination boundary

- Neighbor UI thread: `Улучшить UI` (`01a061b2-119a-7272-91d0-13add13d75c2`), latest immutable UI evidence `941f26da` on `codex/command-desk-ui`.
- Coordination mode: `no-overlap`; this slice changes contracts, orchestration, workspace provisioning, locking, and integration only. No `apps/web/**` files are in scope.
- The UI handoff remains a W71-S14 input. Its server-owned lifecycle and patch-only/no-upstream boundary must stay unchanged.

## Evidence-backed implementation plan

1. Reuse the existing contract-layer `normalizePathScope`, `pathScopesOverlap`, and literal changed-path comparison as the sole segment-aware scope implementation. Wire DAG scheduling, multirepo locks, workspace-set validation, and topology validation to this implementation; reject malformed or ambiguous scopes fail-closed.
2. Convert multirepo lock state to the shared file transaction primitives: lock-scoped read, corruption quarantine, atomic write, revision fencing, expiry, and deterministic conflict evidence. Add contention and invalid/corrupt-state tests.
3. Replace integration's recursive `fs.cpSync` workspace materialization with a no-hardlinks independent Git clone at the authoritative base commit. Record distinct source/target gitdir and index ownership and verify the source checkout remains byte/status/HEAD stable.
4. Validate child outputs against measured repository facts: ownership (project/parent/unit/repository), commit object and ancestry for commit outputs, patch/diff digest, exact measured changed paths, and declared unit scope. Persist these facts in integration evidence and block forged, cross-repository, out-of-scope, or digest-mismatched outputs.
5. Add the canonical scope corpus, multi-process lock stress, isolated-workspace regression, and adversarial output tests; update contract/example docs only if the persisted evidence shape changes.

## Verification

- focused contracts, DAG, multirepo, workspace-set, and integration tests;
- `pnpm lint`, `pnpm typecheck`, `pnpm quality:ratchet`, `pnpm test`;
- `pnpm slice:gate` / CI Node 22 Repo integrity;
- review confirms no UI overlap and preserves the `941f26da` handoff for W71-S14.

