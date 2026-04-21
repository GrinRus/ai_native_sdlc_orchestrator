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
- example project profiles, routes, wrappers, prompt bundles, policies, packets, eval assets, and live E2E profiles;
- contributor guidance through `AGENTS.md`, nested `AGENTS.md` files, and reusable root skills;
- root repository-integrity commands and CI for roadmap, guidance, and community-file consistency;
- a documented live E2E target catalog built around public GitHub repositories.

What does **not** exist yet:

- a production-ready orchestrator runtime;
- real provider adapters for Codex, Claude, or OpenCode;
- delivery write-back automation to upstream repositories;
- operator-grade API and UI surfaces.

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
- `pnpm test` checks backlog consistency across wave docs, the master backlog, the dependency graph, and the epic map.
- `pnpm build` checks scaffold integrity for community files, workflow conventions, and root package settings.
- `pnpm check` runs all of the above in sequence.

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
   Turn live E2E output, scorecards, and incidents into new evals, harness captures, and backlog work.

## Planned command surface

The planned product command surface includes flows such as:

```bash
aor project init
aor project analyze
aor project validate
aor project verify
aor run step
aor eval run
aor harness replay
aor delivery plan
aor delivery apply
```

These commands are part of the roadmap. The current repository package does **not** implement the full runtime yet.

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
- `docs/ops/**` — live E2E runbooks and operator procedures.

### Examples
- `examples/**` — project profiles, routes, wrappers, prompt bundles, policies, adapters, packets, eval assets, and live E2E profiles.

### Code scaffold
- `apps/api/` — planned control-plane API surface.
- `apps/cli/` — planned CLI surface.
- `apps/web/` — planned detachable operator UI.
- `packages/**` — planned shared runtime modules.

### Contributor support
- `.agents/skills/**` — reusable repo skills for agents.
- `.github/**` — CI and GitHub community-health assets.
- `scripts/**` — root repository-integrity checks used by local commands and CI.

## Live E2E target projects

The repo includes a documented target catalog and runbooks for public rehearsal repositories:

- `sindresorhus/ky` — short TypeScript library regressions and short release rehearsals.
- `httpie/cli` — deeper Python CLI regressions.
- `belgattitude/nextjs-monorepo-example` — long monorepo release rehearsals.

See:

- `docs/ops/live-e2e-target-catalog.md`
- `docs/ops/live-e2e-regress-short.md`
- `docs/ops/live-e2e-regress-long.md`
- `docs/ops/live-e2e-release-short.md`
- `docs/ops/live-e2e-release-long.md`

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

## Contributing

Read `CONTRIBUTING.md` before opening a pull request. The short version:

- work in English by default;
- prefer one slice per PR;
- keep contracts, examples, docs, and code aligned;
- do not commit `.aor/`, secrets, or ad hoc scratch state;
- use no-write safety defaults for public-repo rehearsals unless a slice explicitly expands the boundary.

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.
