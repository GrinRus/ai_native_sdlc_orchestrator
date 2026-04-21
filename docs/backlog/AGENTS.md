# AGENTS.md

Use this directory for all shared planning work.

## What lives here

- planning rules
- roadmap and wave plans
- epic map
- master slice index
- slice dependency graph

## Working rules

- Start with `backlog-operating-model.md`.
- Use `mvp-roadmap.md` for wave context.
- Use `mvp-implementation-backlog.md` for the slice index.
- Use the owning wave document for the starter local-task outline.
- Update the epic map and dependency graph when slice shape changes.
- Use `pnpm slice:status`, `pnpm slice:plan`, and `pnpm slice:gate` to keep the loop deterministic.

## Scope rule

The shared backlog tracks waves, epics, and slices.

Local tasks belong inside the owning wave document or your branch-local plan. Do not pollute the shared backlog with tiny one-off tasks.

## Done rule

A backlog change is not done until the owning wave document, the master backlog, and the dependency graph still agree.
