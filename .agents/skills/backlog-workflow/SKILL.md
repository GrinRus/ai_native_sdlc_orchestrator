---
name: backlog-workflow
description: Use when you need to choose a delivery slice, derive local tasks, split a slice, or verify that a change still matches the current roadmap.
---

1. Start in `docs/backlog/backlog-operating-model.md` to understand the wave → epic → slice → local task model.
2. Read `docs/backlog/mvp-roadmap.md` for the current wave goals and exit criteria.
3. Use `docs/backlog/mvp-implementation-backlog.md` to find a `ready` slice or the next blocked slice whose dependencies you are explicitly closing.
4. Confirm the hard-dependency order in `docs/backlog/slice-dependency-graph.md`.
5. Open the owning wave document and begin with its built-in `### Local tasks` section.
6. Refine those local tasks branch-locally if needed, but stay inside one slice unless the work has become a new independently acceptable outcome.
7. If behavior changes are user-visible, use `story-traceability` to verify the slice still closes the intended user outcome.
8. Close the slice only after every acceptance criterion has reviewable evidence in docs, examples, tests, or runnable commands.
9. If you add or split a slice, update the wave document, the master backlog, the epic map, and the dependency graph together.
