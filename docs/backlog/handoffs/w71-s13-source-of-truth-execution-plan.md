# W71-S13 source-of-truth and story-evidence execution plan

## Task contract

- Outcome: align current runtime-root guidance, backlog/readiness summaries,
  contract/runbook indexes, and story evidence claims with the implemented
  central-AOR-Home flow.
- Scope: `scripts/readiness/source-of-truth.mjs`,
  `scripts/reference-integrity.mjs`, current docs/indexes, and the story
  evidence registry. No UI-owned files.
- Acceptance: semantic drift fails `pnpm test:references`; the W71 planning
  snapshot and story evidence tiers agree with the structured registries; all
  affected claims remain partial until S14 installed proof.

## UI coordination

- Sibling task: `Улучшить UI и UX`
- Sibling checkout: `/Users/griogrii_riabov/grigorii_projects/ai_native_sdlc_orchestrator`
- Immutable handoff observed: commit `59943bfaa7af0c97b1eff38e7093aced069d0fb9`
- Disposition: `no-overlap` — the sibling UI change set is limited to
  `apps/web/**` and its product-design doc; S13 owns only contracts, docs,
  indexes, readiness semantics, and non-visual validation.
- Integration owner: W71-S14 must merge or otherwise bind the immutable UI
  handoff before touching UI-owned paths.

## Implementation plan

1. Add semantic current-doc runtime-root checks that allow only explicit
   portable/export, historical, qualification, or ignored rehearsal `.aor`
   references outside central AOR Home.
2. Add bidirectional contract/runbook index checks and register previously
   dangling qualification and operations docs.
3. Add a deterministic W71 planning/readiness snapshot checked against the
   parsed backlog model and preserve historical snapshot labels.
4. Add an evidence-tier registry and protected-story checks that keep audited
   integrated claims partial and S14-owned.
5. Run focused reference/readiness tests, lint/typecheck, then the canonical
   slice gate; review changed paths for UI overlap before handoff.

## Closure

- Implementation commit: `f617f3e6`.
- PR: #319, merged to `main` as `7a0e22e1`.
- CI: CodeQL, Dependency Review, OpenSSF Scorecard, and Node 22 Repo integrity
  all passed (the first Node 22 attempt exposed a transient concurrent intent
  test failure and was rerun successfully).
- Focused evidence: `pnpm test:references`, source-of-truth tests 5/5,
  `pnpm lint`, `pnpm typecheck`, `pnpm quality:ratchet`, and full `pnpm check`.
- S13 state: `done`; S14 remains blocked until the sibling UI handoff is merged
  or explicitly bound by the integration owner.
