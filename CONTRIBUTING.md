# Contributing to AOR

Thanks for contributing to AOR.

AOR is a docs-first and scaffold-first repository today. The highest-value contributions are the ones that keep the roadmap, contracts, examples, and implementation scaffold aligned while the runtime is being built.

## Ways to contribute

You can help by:

- reporting gaps or contradictions in the product, architecture, or contract docs;
- improving examples, runbooks, and live E2E profiles;
- refining the roadmap, epic map, or dependency graph;
- implementing one bounded backlog slice at a time;
- strengthening repository-integrity checks, CI, or contributor guidance.

## Before you start

Read these in order:

1. `README.md`
2. `AGENTS.md`
3. `docs/backlog/backlog-operating-model.md`
4. `docs/backlog/mvp-roadmap.md`
5. the nearest `AGENTS.md` to the files you plan to change

If the change is implementation work, find the owning slice first. Do not start by writing broad code without a slice boundary.

## Development workflow

1. Fork the repository and create a topic branch.
2. Pick one slice from `docs/backlog/mvp-implementation-backlog.md`.
3. Open the owning wave document and use its built-in local-task outline as your starting plan.
4. Keep the PR bounded to one slice whenever possible.
5. Update docs, contracts, examples, and code together.
6. Run the root checks:
   ```bash
   pnpm install
   pnpm lint
   pnpm test
   pnpm build
   ```
7. Open a focused pull request with the evidence needed to review the slice.

## Continuous slice loop

Use the slice helper commands to keep one-slice-at-a-time delivery explicit:

```bash
pnpm slice:status
pnpm slice:next -- --json
pnpm slice:plan -- W0-S04
pnpm slice:sync-ready -- --apply
pnpm slice:gate
pnpm slice:complete -- W0-S04 --apply
```

Notes:

- `slice:sync-ready` recalculates `ready` and `blocked` from hard dependencies.
- `slice:complete` updates both the master backlog and the owning wave doc state.
- `slice:gate` runs the mandatory pre-commit gate (`lint`, `test`, `build`, `check`).

## CI acceptance gates

The repository uses a single workflow: `.github/workflows/ci.yml`.

It runs on:
- pull requests;
- pushes to `main`;
- manual `workflow_dispatch`.

What it proves today:
- `pnpm lint` validates guidance coverage and required repo files;
- `pnpm test` validates backlog consistency, contracts loading, reference integrity, and slice-cycle behavior;
- `pnpm build` validates scaffold integrity and workflow/community-file conventions.

If CI fails, the failing step maps directly to one of these root checks so the remediation path stays explicit.

## Repo-specific rules

- English is the default project language.
- Packet-first and contract-first rules are non-negotiable.
- Keep orchestrator core runner-agnostic.
- Do not commit `.aor/`, secrets, personal access tokens, or machine-local scratch notes.
- Public-repo rehearsals must stay no-write by default unless the selected slice explicitly expands the write-back boundary.
- If a flow changes, update the matching runbook or live E2E profile in the same PR.

## Picking work

Use this sequence:

1. `docs/backlog/mvp-roadmap.md`
2. `docs/backlog/mvp-implementation-backlog.md`
3. `docs/backlog/slice-dependency-graph.md`
4. the owning wave document
5. `docs/backlog/orchestrator-epics.md` when you need the cross-wave context

The shared backlog tracks **waves, epics, and slices**. Local tasks are derived from the owning wave document and do not become new shared backlog items unless they introduce a new independently acceptable outcome.

## Pull request checklist

Before opening a PR, confirm that:

- the change still fits one slice or one tightly related bug fix;
- the owning wave doc still describes the work accurately;
- examples still match the contracts they illustrate;
- the relevant docs were updated;
- root checks were run;
- acceptance criteria have reviewable evidence.

## Bug reports

A strong bug report should include:

- what you expected to happen;
- what actually happened;
- exact steps to reproduce;
- the relevant command, profile, route, wrapper, or target repo;
- logs, transcripts, or artifact paths when relevant;
- whether the issue affects a specific wave, slice, or live E2E scenario.

Never paste secrets, tokens, or private repository credentials into an issue.

## Feature requests

A strong feature request should include:

- the user problem being solved;
- the primary user-story surfaces affected;
- the expected outcome;
- where the change likely belongs in the roadmap;
- whether it should be a new slice, a split of an existing slice, or a later-wave addition.

## Review expectations

Reviewers will look for:

- bounded scope;
- contract and example alignment;
- durable evidence for acceptance criteria;
- safe public-repo behavior;
- clear docs for anything user-visible or operator-visible.

## Issue and PR templates

Use the repository templates under `.github/` when they fit. They are intentionally aligned with the slice-first planning model.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0 that applies to this repository.
