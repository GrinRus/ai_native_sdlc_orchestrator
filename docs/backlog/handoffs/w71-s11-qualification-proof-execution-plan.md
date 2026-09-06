# W71-S11 execution handoff

## Scope and UI coordination

- Slice: `W71-S11` — resolvable evidence and adversarial qualification proof.
- UI thread: `Улучшить UI и UX` (`01a061b2-119a-7272-91d0-13add13d75c2`).
- Latest UI evidence checked before implementation: commit `941f26da`
  (`feat(web): align command desk target geometry`), with the UI thread marked
  complete after browser, responsive, keyboard, console, and web validation.
- Coordination mode: `no-overlap`; this slice does not edit `apps/web/**` or
  UI-owned screenshots/assets. The installed UI journey remains an S14
  integration concern; S11 only hardens the evidence and qualification
  contracts that the merged UI will consume.

## Contract-first plan

1. Route qualification-cell artifacts through the shared AOR evidence resolver
   and retain legacy `evidence://` readability. Recompute bytes and digests,
   enforce project/run/cell/source/target identity, reject moved/missing,
   traversal, symlink, malformed, and mutated evidence, and make retention and
   redaction metadata explicit in the report.
2. Add one freshness/identity classifier for provider attempts and required
   cells. A changed source commit, target commit, profile digest, proof digest,
   or qualification identity resets usable passing counts for pending, blocked,
   failed, and passed cells; stale evidence is diagnostic-only and explains
   the invalidation.
3. Extend the deterministic W66 proof with family-level positive, negative,
   repaired, concurrency, and mutation-sensitivity cases. Every case names the
   owning validator/materializer and fails closed if the family is bypassed.
4. Align qualification fixtures and current live profiles with central AOR Home
   and target cleanliness. Preserve the canonical Task prepare/start, Ask AOR,
   review, delivery, release, and learning lineage without adding UI code.
5. Run focused qualification/evidence tests, `pnpm w66:proof`, `pnpm slice:gate`,
   and the repository gate. Review the diff for contract drift and UI overlap
   before branch/PR closure.

## Acceptance evidence

- Qualification reports resolve real bytes through the shared resolver and
  fail closed on missing, moved, mutated, mismatched, or unresolvable refs.
- Frozen identity changes invalidate every matrix cell and reset passing counts,
  including blocked and historical states.
- W66 proof reports distinct validator-owned cases and mutation/concurrency
  sensitivity for each claimed family.
- Current profile/fixture evidence is central-AOR-Home based, target-clean, and
  preserves canonical Task lifecycle lineage without upstream writes.
