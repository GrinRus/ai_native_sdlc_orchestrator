# W71-S12 quality ratchets execution plan

## Task contract

- Outcome: make quality coverage and maintainability debt measurable and
  non-increasing without mixing behavior-preserving hotspot refactoring into
  this slice.
- In scope: `scripts/quality-ratchet.mjs`, `scripts/quality-baseline.json`,
  `scripts/test-manifest.json`, the focused quality/coverage tests, and the
  owning W71 backlog evidence.
- Out of scope: `apps/web/**`, provider performance, paid qualification, and
  decomposition of the largest historical hotspot (owned by W71-S15).
- Acceptance: every production source file is assigned lint/typecheck
  ownership or an owned, unexpired exception; structural debt metrics cannot
  increase; critical-path coverage is represented by executable negative-path
  evidence; exceptions contain owner, rationale, expiry, ceiling, and a
  successor slice.
- Verification: focused ratchet/coverage tests, `pnpm lint`, `pnpm typecheck`,
  `pnpm quality:ratchet`, and the applicable slice gate/CI checks.

## UI coordination

The neighboring UI task is `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`)
on `codex/command-desk-ui`. Its latest immutable commit is `941f26da`
(`feat(web): align command desk target geometry`), already merged to `main`.
The UI task reports responsive target geometry, keyboard focus, 200% zoom, and
browser/build checks complete. S12 uses `mode: no-overlap`: it does not edit
`apps/web/**` or UI test files. Re-check the thread before each subsequent
slice; if the UI task resumes, use `contract-handoff` for shared contracts and
`merge-first` when a changed file overlaps this slice.

## Implementation plan

1. Extend the quality baseline with explicit schema-versioned structural debt
   metrics and a manifest of time-boxed exceptions.
2. Make `quality-ratchet` discover all production files, validate ownership and
   expiries, compute deterministic file/function/complexity/nesting/clone/dead
   code signals, and fail when committed baseline counts or ceilings increase.
3. Keep `gate-coverage` as the source of lint/typecheck ownership and require
   its report to account for every non-generated production source file.
4. Add a critical-path coverage manifest linking invariants to focused tests and
   require both positive and negative evidence to be present and runnable.
5. Add mutation-style tests that raise each debt class or remove a critical
   negative-path entry and assert that the ratchet fails closed.
6. Update the wave/master backlog and audit disposition only after focused
   evidence is green; leave the hotspot-decomposition portion owned by S15.

## Handoff and evidence

The implementation commit will include this plan and machine-readable reports
under ignored `.aor/quality/`. Closure will record the PR, merge SHA, focused
test results, and the known Node 25 local CLI-worker limitation if it remains;
Node 22 CI is the supported-version source of truth.
