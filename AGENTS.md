# AGENTS.md

AOR is an AI-native orchestrator for the full SDLC: bootstrap, discovery, specification, planning, execution, review, QA, delivery, release, and learning.

## Read this first

- `README.md` for the repo map and the current implementation status.
- `CONTRIBUTING.md` for the contributor workflow and PR expectations.
- `docs/architecture/12-orchestrator-operating-model.md` for the end-to-end runtime model.
- `docs/contracts/00-index.md` for the system contracts.
- `docs/backlog/backlog-operating-model.md` and `docs/backlog/mvp-roadmap.md` for planning work.
- The nearest `AGENTS.md` in the directory you are editing. More local guidance wins.

## Current repo state

- This repository is still a docs-first and scaffold-first package.
- Root commands are repository-integrity checks, not a full product runtime:
  - `pnpm install`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - `pnpm check`
- Runtime outputs belong in `.aor/` and must not be committed.

## Language policy

- English is the default project language for docs, contracts, examples, comments, and commit-ready artifacts.
- Keep names, labels, and examples in English unless an external source requires another language.

## How to work in this repo

1. Classify the change first: product, architecture, contract, example, ops, backlog, implementation, or community/CI.
2. For implementation work, choose one slice from the backlog before changing code.
3. Open the owning wave document and start from its built-in local-task outline.
4. Update source-of-truth docs before or together with code.
5. Keep contracts, examples, docs, and code aligned.
6. Run the root checks before you consider the change done.
7. Use the slice cycle helper (`pnpm slice:status`, `pnpm slice:plan`, `pnpm slice:gate`) to keep queueing and quality gates explicit.

## Non-negotiable rules

- Packet-first: packets, reports, profiles, manifests, and scorecards are first-class artifacts.
- Contract-first: define or update the contract before implementation details depend on it.
- Runner-agnostic core: do not leak provider-specific behavior into orchestrator core.
- Validation before evaluation: deterministic checks come before judge-based checks.
- Harness by default: quality-sensitive flows must explain replay, evaluation, and certification.
- Headless-first runtime: `apps/web` is optional and detachable.
- Bounded execution: scope, commands, budgets, and write-back mode must stay explicit.
- Public-repo safety first: no upstream writes by default in live E2E or delivery rehearsals.

## Where changes usually belong

- Product scope and user stories: `docs/product/**`
- Research notes and external references: `docs/research/**`
- Architecture and flows: `docs/architecture/**`
- Contracts and schemas: `docs/contracts/**`
- Roadmap, epics, slices, and local-task planning: `docs/backlog/**`
- Runbooks and live E2E: `docs/ops/**` and `examples/live-e2e/**`
- Project examples: `examples/**`
- API, CLI, and web surfaces: `apps/**`
- Shared runtime modules: `packages/**`
- CI, issue templates, and community files: `.github/**`
- Repository-integrity checks: `scripts/**`

## Done means

- The relevant docs are updated.
- The nearest wave, epic, or slice docs still match the change.
- Examples still match the contracts they illustrate.
- Root checks passed locally or you documented why a check is intentionally pending.
- No runtime state, secrets, or ad hoc notes were committed.

## Skills

Use the root skills when they help:

- `repo-navigation`
- `contract-first-change`
- `backlog-workflow`
- `story-traceability`
- `live-e2e-preflight`
- `live-e2e-runner`
