# AOR — AI-native Orchestrator for Full SDLC

AOR is a runner-agnostic control plane for the full software delivery lifecycle:

**bootstrap → discovery → research/spec → planning/approval → execution → review/QA → delivery/release → incident/learning**

AOR is **not** another coding agent and **not** a thin wrapper around one model or one CLI. It is the orchestration layer that turns a software project into a machine-usable target, routes work across different runners, evaluates quality by default, and leaves behind durable packets, manifests, and decision artifacts.

## Why AOR

Teams need more than code generation. They need a system that can:

- bootstrap a repository into an AI-usable project target;
- support multiple runners such as Codex CLI, Claude Code, OpenCode, and future internal adapters;
- evolve prompts, wrappers, routes, and policies safely;
- work across monoliths and bounded multirepo setups;
- make validation, eval, and harness first-class from day one;
- rehearse the entire flow on real open-source repositories before enabling production write-back.

## Current repository status

This repository is currently a **docs-first and scaffold-first project package**.

What exists today:

- product, research, architecture, contract, ops, and backlog documentation;
- example project profiles, routes, wrappers, prompt bundles, policies, packets, eval assets, and proof fixtures;
- contributor guidance through `AGENTS.md`, nested `AGENTS.md` files, and reusable root skills;
- root repository-integrity commands and CI for roadmap, guidance, and community-file consistency;
- a documented internal installed-user rehearsal target catalog built around public GitHub repositories;
- a layered live E2E model: bounded rehearsal profiles plus a catalog-backed full-journey layer on curated repositories and curated feature missions tracked through `W13`;
- implemented operator baseline surfaces: control-plane read APIs, live-run event streaming, operator CLI commands, detachable web console baseline, and an internal black-box rehearsal harness tracked through `W12`.
- expanded implementation backlog through W11 slices with active queue tracking via `pnpm slice:status` and `pnpm slice:next -- --json`.
- reopened post-audit productionization queue for external live adapter execution, networked fork-first delivery, authenticated mutation transport, and a dedicated W11 target-backed proof-closure wave.
- first live routed execution baseline for supported `codex-cli` adapter paths with explicit delivery-guardrail blocking semantics.

What does **not** exist yet:

- a production-ready orchestrator runtime;
- broad multi-provider production-grade adapter coverage (beyond the first `codex-cli` live baseline);
- delivery write-back automation to upstream repositories;
- full planned command surface and production hardening for all operator/delivery controls.

Use the backlog docs for the implementation roadmap.

## Reader quickstart

Start here if you want to understand the project before implementing anything:

1. `AGENTS.md`
2. `docs/product/01-project-description.md`
3. `docs/architecture/12-orchestrator-operating-model.md`
4. `docs/contracts/00-index.md`
5. `docs/backlog/backlog-operating-model.md`
6. `docs/backlog/mvp-roadmap.md`
7. `docs/ops/live-e2e-target-catalog.md`
8. `docs/ops/live-e2e-dependency-matrix.md`

## Contributor quickstart

Current repo bootstrap:

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm check
```

What these commands do today:

- `pnpm lint` checks contributor-guidance coverage and required repo files.
- `pnpm test` checks backlog consistency and runs package/app test suites (contracts, CLI, API, web, routing, adapter SDK, harness, orchestrator core, and reference integrity).
- `pnpm build` checks scaffold integrity for community files, workflow conventions, and root package settings.
- `pnpm check` runs all of the above in sequence.

CI runs the same gate on pull requests, pushes to `main`, and manual workflow dispatch through `.github/workflows/ci.yml`.

Suggested implementation workflow:

1. Pick one `ready` slice from `docs/backlog/mvp-implementation-backlog.md`.
2. Open the owning wave document and use the built-in local-task outline.
3. Keep the change bounded to one slice whenever possible.
4. Update docs, examples, contracts, and code together.
5. Run the root checks before opening a PR.

Useful helpers for the slice loop:

- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:plan -- <SLICE_ID>`
- `pnpm slice:gate`

For the repo-specific rules, read `CONTRIBUTING.md` and the nearest `AGENTS.md`.

For internal rehearsal dependency requirements, see `docs/ops/live-e2e-dependency-matrix.md`.

## How AOR works

At a high level, AOR is intended to work like this:

1. **Bootstrap the target repository**  
   Load a project profile, inspect the repo, validate configuration, and verify bounded runnable prerequisites.

2. **Materialize durable artifacts**  
   Create project-analysis reports, validation reports, step results, packets, manifests, and release evidence under `.aor/`.

3. **Resolve runtime assets**  
   For each step, resolve the route, wrapper, prompt bundle, and step policy before adapter execution begins.

4. **Execute through adapters**  
   Send bounded work to a selected runner through the adapter SDK while preserving policy and provenance metadata.

5. **Validate, evaluate, and replay**  
   Run deterministic validation first, then offline evals, harness replay, certification, and promotion decisions.

6. **Deliver through bounded write-back modes**  
   Start with no-write, patch, and local-branch modes; then expand to fork-first GitHub delivery when the quality bar is met.

7. **Operate through CLI, API, and detachable UI**  
   Keep the runtime headless-first, with optional live event streams and a detachable web console.

8. **Feed learning back into the platform**  
   Turn installed-user rehearsal output, review verdicts, scorecards, and incidents into new evals, harness captures, and backlog work.

## Command surface status

The CLI command surface currently includes **33 implemented** commands and **0 planned** commands (source of truth: `apps/cli/src/command-catalog.mjs` and `docs/architecture/14-cli-command-catalog.md`).

Implemented command groups:
- project lifecycle: `project init`, `project analyze`, `project validate`, `project verify`;
- intake/discovery/spec/wave: `intake create`, `discovery run`, `spec build`, `wave create`;
- run control and monitoring: `run start`, `run pause`, `run resume`, `run steer`, `run cancel`, `run status`;
- quality and handoff: `eval run`, `harness replay`, `harness certify`, `asset promote`, `asset freeze`, `handoff prepare`, `handoff approve`;
- delivery/release and operator reads: `deliver prepare`, `release prepare`, `packet show`, `evidence show`;
- incidents and audit: `incident open`, `incident recertify`, `incident show`, `audit runs`;
- review and learning closure: `review run`, `learning handoff`;
- UI lifecycle: `ui attach`, `ui detach`.

Planned commands:
- none in the current shell baseline.

For exact command inputs/outputs and contract linkage, use `docs/architecture/14-cli-command-catalog.md`.

## Repository map

### Product and research
- `docs/product/**` — scope, user stories, and project definition.
- `docs/research/**` — external best practices and analytical notes.

### Architecture and contracts
- `docs/architecture/**` — target architecture, flows, runtime model, and module map.
- `docs/contracts/**` — packet, profile, report, API, and evaluation contracts.

### Backlog and roadmap
- `docs/backlog/**` — operating model, roadmap, epic map, wave plans, and dependency graph.

### Operations
- `docs/ops/**` — installed-user rehearsal runbooks and operator procedures.

### Examples
- `examples/**` — project profiles, routes, wrappers, prompt bundles, policies, adapters, packets, eval assets, and proof fixtures.

### Code scaffold
- `apps/api/` — implemented control-plane read/event baseline with detached HTTP/SSE transport for connected-mode read/follow surfaces.
- `apps/cli/` — implemented bootstrap, quality, handoff, operator-read, delivery, incident, and UI-lifecycle command baseline with planned extensions.
- `apps/web/` — implemented detachable operator console baseline with planned production-hardening extensions.
- `packages/**` — implemented shared runtime modules (contracts, orchestrator core, routing, adapter SDK, harness, observability) with roadmap extensions.
- `scripts/live-e2e/**` — internal black-box installed-user rehearsal harness and private scenario profiles.

### Contributor support
- `.agents/skills/**` — reusable repo skills for agents.
- `.github/workflows/ci.yml` — pinned, least-privilege CI workflow for repo integrity checks.
- `.github/ISSUE_TEMPLATE/bug-report.md` — bug-report template.
- `.github/ISSUE_TEMPLATE/feature-request.md` — feature-request template.
- `.github/PULL_REQUEST_TEMPLATE.md` — pull-request checklist template.
- `scripts/**` — root repository-integrity checks used by local commands and CI.

## Live E2E target projects

The repo includes a documented internal target catalog and internal runbooks for public rehearsal repositories:

- `sindresorhus/ky` — short TypeScript library regressions and short release rehearsals.
- `httpie/cli` — deeper Python CLI regressions.
- `belgattitude/nextjs-monorepo-example` — long monorepo release rehearsals.

See:

- `docs/ops/live-e2e-target-catalog.md`
- `docs/ops/live-e2e-standard-runner.md`
- `docs/ops/live-e2e-regress-short.md`
- `docs/ops/live-e2e-regress-long.md`
- `docs/ops/live-e2e-release-short.md`
- `docs/ops/live-e2e-release-long.md`

The W13 full-journey layer resolves these repositories and feature missions through an internal machine-readable catalog under `scripts/live-e2e/catalog/**`. Bounded `regress/release short/long` profiles remain, but they no longer claim to prove the entire installed-user journey.

## Roadmap

The implementation roadmap is tracked as **wave → epic → slice → local task**.

Start with:

- `docs/backlog/backlog-operating-model.md`
- `docs/backlog/mvp-roadmap.md`
- `docs/backlog/mvp-implementation-backlog.md`
- `docs/backlog/orchestrator-epics.md`
- `docs/backlog/slice-dependency-graph.md`

Detailed wave plans:

- `docs/backlog/wave-0-implementation-slices.md`
- `docs/backlog/wave-1-implementation-slices.md`
- `docs/backlog/wave-2-implementation-slices.md`
- `docs/backlog/wave-3-implementation-slices.md`
- `docs/backlog/wave-4-implementation-slices.md`
- `docs/backlog/wave-5-implementation-slices.md`
- `docs/backlog/wave-6-implementation-slices.md`
- `docs/backlog/wave-7-implementation-slices.md`
- `docs/backlog/wave-8-implementation-slices.md`
- `docs/backlog/wave-9-implementation-slices.md`
- `docs/backlog/wave-10-implementation-slices.md`
- `docs/backlog/wave-11-implementation-slices.md`
- `docs/backlog/wave-12-implementation-slices.md`
- `docs/backlog/wave-13-implementation-slices.md`

## Contributing

Read `CONTRIBUTING.md` before opening a pull request. The short version:

- work in English by default;
- prefer one slice per PR;
- keep contracts, examples, docs, and code aligned;
- do not commit `.aor/`, secrets, or ad hoc scratch state;
- use no-write safety defaults for public-repo rehearsals unless a slice explicitly expands the boundary.

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.
