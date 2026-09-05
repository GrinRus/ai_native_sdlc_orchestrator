---
name: backlog-workflow
description: Select, plan, implement, or close an AOR delivery slice, or review whether work still matches its wave, dependencies, and acceptance criteria.
---

## Select or review

Start with `docs/backlog/backlog-operating-model.md` and
`docs/backlog/mvp-roadmap.md`. Find the relevant slice in
`docs/backlog/mvp-implementation-backlog.md`, then inspect its owning wave and
hard dependencies in `docs/backlog/slice-dependency-graph.md`.

Use `pnpm slice:status`, `pnpm slice:next`, and
`pnpm slice:plan -- <SLICE_ID>` for read-only selection and planning. Follow the
selected ready slice or an explicitly identified dependency unblocker. A request
to review or plan ends with proposed tasks, gaps, and evidence; it does not apply
backlog state transitions.

## Implement or reshape

Use the owning wave's `### Local tasks` as the local plan. For medium+ slices,
preserve each task's Purpose, concrete Changes, and Validation detail. Keep local
refinements within the slice unless they create an independently acceptable
outcome. If adding or splitting a slice is in scope, update the owning wave,
master backlog, `docs/backlog/orchestrator-epics.md`, and dependency graph together.
Use `story-traceability` when user-visible behavior changes.

The bounded bug/maintenance exception in `CONTRIBUTING.md` still applies; this
skill does not require a new feature slice for every fix.

## Verify and close

Select focused checks from [the validation matrix](../../../CONTRIBUTING.md#validation-by-change-type),
then run `pnpm slice:gate` for a commit-ready slice. It delegates once to
`pnpm check`; do not run lint, test, and build as duplicate second passes.

When implementing or closing the slice is in scope, close it only after every
acceptance criterion has reviewable evidence and the applicable gate passes.
Preview `pnpm slice:complete -- <SLICE_ID>`, inspect the proposed state changes,
then use `pnpm slice:complete -- <SLICE_ID> --apply` and review the resulting
backlog diff. A successful gate alone does not prove slice completion or request
a commit.
