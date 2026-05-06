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

This repository is currently a **docs-first project package with implemented CLI/API/web/runtime baselines**. It is not yet a production-ready orchestrator runtime.

What exists today:

- product, research, architecture, contract, ops, and backlog documentation;
- example project profiles, routes, wrappers, prompt bundles, policies, packets, eval assets, and proof fixtures;
- contributor guidance through `AGENTS.md`, nested `AGENTS.md` files, and reusable root skills;
- root repository-integrity commands and CI for roadmap, guidance, and community-file consistency;
- a documented internal installed-user rehearsal target catalog built around public GitHub repositories;
- a layered live E2E model: bounded rehearsal profiles plus a curated full-journey matrix on catalog repositories across scenario family, pinned provider, and size-classed feature missions tracked through `W14`;
- implemented operator baseline surfaces: control-plane read APIs, planner metrics snapshots, live-run event streaming, operator CLI commands, detachable web console baseline, and an installed-user black-box proof runner tracked through `W12`.
- expanded implementation backlog through `W21`, with W18 focused on connected web full-flow and topology proof gaps, W19/W20 focused on user-story gap traceability, product-quality closure, and production/platform maturity gaps, and W21 focused on installed-user onboarding plus guided UX closure while active queue tracking stays available via `pnpm slice:status` and `pnpm slice:next -- --json`.
- historical W10/W11 productionization closure for external live adapter execution, networked fork-first delivery, authenticated mutation transport, and target-backed proof evidence.
- stable live routed execution baseline for supported `codex-cli` adapter paths, plus live-runnable candidate `claude-code` matrix coverage and extended non-baseline `open-code` coverage with explicit delivery-guardrail blocking semantics.
- W15 readiness-hardening work that makes source-of-truth drift, package/module-map drift, and mock-backed proof claims machine-checkable.
- W16 complexity-reduction work that decomposes monolithic CLI/API/core/live-E2E surfaces and isolates adapter permission legacy cleanup.
- W17 legacy-surface cleanup that removes public compatibility aliases from CLI incident outputs and delivery mode inputs.
- W18 backlog coverage for control-plane-owned web lifecycle operation, runner question/answer continuation, and bounded multirepo proof.
- W19/W20/W21 backlog gap intake that maps all 112 supported user stories to current evidence, coverage status, and explicit follow-up slices for remaining gaps.
- W20 production-hardening baseline for detached control-plane transport mode, bearer auth/authz scopes, redaction of configured secrets across JSON/SSE/CLI surfaces, and denied-action audit evidence.

What does **not** exist yet:

- a production-ready orchestrator runtime;
- broad multi-provider production-grade adapter coverage beyond the stable `codex-cli` live baseline and candidate `claude-code` rehearsal coverage;
- delivery write-back automation to upstream repositories;
- enterprise identity-provider integration, hosted SaaS deployment hardening, and operator parity for every CLI/API/web control surface;
- a real code-changing full-journey proof with `overall_verdict=pass`; the current W14 matrix proof is coverage evidence with findings, and this target is not assigned to the current W18-W21 backlog horizon.

Use the backlog docs for the implementation roadmap.

## Reader quickstart

Start here if you want to understand the project before implementing anything:

1. `AGENTS.md`
2. `docs/product/01-project-description.md`
3. `docs/product/02-installed-user-onboarding-journey.md`
4. `docs/architecture/12-orchestrator-operating-model.md`
5. `docs/contracts/00-index.md`
6. `docs/backlog/backlog-operating-model.md`
7. `docs/backlog/mvp-roadmap.md`
8. `docs/ops/live-e2e-target-catalog.md`
9. `docs/ops/live-e2e-dependency-matrix.md`

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

3. **Resolve and compile runtime assets**
   For each routed adapter-backed step, resolve the route, wrapper, prompt bundle, context assets, and step policy, then persist the compiled context before adapter execution begins.

4. **Execute through the Runtime Harness**
   Send bounded work to a selected runner through the adapter SDK, classify outcomes, validate mission semantics, decide retry/repair/escalation, and preserve policy/provenance metadata.

5. **Validate, evaluate, and certify separately**
   Run deterministic validation first, then offline evals. Runtime Harness reports diagnose runs; asset certification uses capture/replay and promotion decisions for platform assets.

6. **Deliver through bounded write-back modes**  
   Start with `no-write`, `patch-only`, and `local-branch` modes; then expand to `fork-first-pr` GitHub delivery when the quality bar is met.

7. **Operate through CLI, API, and detachable UI**  
   Keep the runtime headless-first, with optional live event streams and a detachable web console.

8. **Feed learning back into the platform**  
   Turn installed-user proof output, Runtime Harness reports, review verdicts, scorecards, and incidents into new evals, recertification recommendations, and backlog work.

## Command surface status

The CLI command surface currently includes **38 implemented** commands and **0 planned** commands (source of truth: `apps/cli/src/command-catalog.mjs` and `docs/architecture/14-cli-command-catalog.md`).

Implemented command groups:
- project lifecycle: `project init`, `project analyze`, `project validate`, `project verify`;
- intake/discovery/spec/wave: `intake create`, `discovery run`, `spec build`, `wave create`;
- run control and monitoring: `run start`, `run pause`, `run resume`, `run steer`, `run cancel`, `run status`;
- quality and handoff: `eval run`, `harness replay`, `harness certify`, `asset promote`, `asset freeze`, `compiler revision`, `handoff prepare`, `handoff approve`;
- delivery/release and operator reads: `deliver prepare`, `release prepare`, `multirepo lock`, `packet show`, `evidence show`;
- incidents and audit: `incident open`, `incident backfill`, `incident recertify`, `incident show`, `audit runs`;
- review and learning closure: `review run`, `review decide`, `learning handoff`;
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
- `apps/api/` — implemented control-plane read/event baseline with detached HTTP/SSE transport, production-hardened bearer auth/authz mode, and redacted response/event surfaces.
- `apps/cli/` — implemented bootstrap, quality, handoff, operator-read, delivery, incident, and UI-lifecycle command baseline with secret-safe JSON output support.
- `apps/web/` — implemented detachable operator console baseline over shared control-plane auth and mutation semantics.
- `packages/**` — implemented shared runtime modules (contracts, orchestrator core, routing, adapter SDK, harness, observability) with roadmap extensions.
- `packages/harness/` — asset certification capture/replay primitives used by certification and promotion decisions.
- `scripts/live-e2e/**` — installed-user black-box proof runner and private scenario profiles.

### Contributor support
- `.agents/skills/**` — reusable repo skills for agents.
- `.github/workflows/ci.yml` — pinned, least-privilege CI workflow for repo integrity checks.
- `.github/ISSUE_TEMPLATE/bug-report.md` — bug-report template.
- `.github/ISSUE_TEMPLATE/feature-request.md` — feature-request template.
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist template.
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

The W14 full-journey layer resolves these repositories through an internal machine-readable matrix under `scripts/live-e2e/catalog/**`. Each full-journey run now pins:
- `target_catalog_id`
- `feature_mission_id`
- `scenario_family`
- `provider_variant_id`

Target catalogs carry one curated `small`, `medium`, and `large` mission per repo plus required matrix cells. `openai-primary` and `anthropic-primary` are the mandatory provider variants for W14 matrix coverage; `open-code-primary` starts as extended coverage only. Bounded `regress/release short/long` profiles remain, but they no longer claim to prove the entire installed-user journey.

The current committed matrix proof bundle lives at `examples/live-e2e/fixtures/w14-s07/w14-s07-evidence-bundle.json` and proves all W14 required matrix cells plus all repo-level `openai-primary` / `anthropic-primary` provider-comparison pairs as coverage evidence. It is intentionally marked `proof_scope=coverage_with_findings` because deterministic external-runner mocks do not materialize mission code changes.

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
- `docs/backlog/wave-14-implementation-slices.md`
- `docs/backlog/wave-15-implementation-slices.md`
- `docs/backlog/wave-16-implementation-slices.md`
- `docs/backlog/wave-17-implementation-slices.md`
- `docs/backlog/wave-18-implementation-slices.md`
- `docs/backlog/wave-19-implementation-slices.md`
- `docs/backlog/wave-20-implementation-slices.md`
- `docs/backlog/wave-21-implementation-slices.md`

## Contributing

Read `CONTRIBUTING.md` before opening a pull request. The short version:

- work in English by default;
- prefer one slice per PR;
- keep contracts, examples, docs, and code aligned;
- do not commit `.aor/`, secrets, or ad hoc scratch state;
- use no-write safety defaults for public-repo rehearsals unless a slice explicitly expands the boundary.

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.
