# W0 implementation slices

## Wave objective
Turn the design package into a contributor-safe and machine-validated repository foundation.

## Wave exit criteria
- the workspace has honest root commands and a stable scaffold for future packages and apps
- contracts and examples are loaded and checked through shared validation paths
- the backlog model is wave → epic → slice → local task and is usable by agents without guesswork
- live E2E profiles support a no-write preflight path before any delivery automation exists
- CI gates prevent contract, example, and roadmap drift

## Parallel start and sequencing notes
- `W0-S01` and `W0-S04` can start immediately.
- `W0-S02` starts after the workspace baseline exists.
- `W0-S05` should reuse the shared contract/example loader instead of inventing its own parser path.

---

## W0-S01 — Workspace and package build baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Replace the echo-only scaffold with an honest root command surface that can host real apps, packages, and repo checks.
- **Primary modules:** root workspace files, `apps/**`, `packages/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, repo hygiene

### Local tasks
1. Add a minimal but truthful root command surface for install, lint, test, build, and check.
2. Define the workspace, Node, and TypeScript conventions that later packages and apps must inherit.
3. Add scaffold guidance for where future runtime modules and surfaces belong.
4. Document the current local bootstrap flow in `README.md` and root `AGENTS.md`.

### Acceptance criteria
1. Root `pnpm build`, `pnpm test`, and `pnpm lint` run real repository checks instead of placeholder echo scripts.
2. The root workspace files state the intended package manager, Node version, and workspace boundaries.
3. The scaffold fails honestly when required repo assets are missing or inconsistent.
4. Root documentation explains what is implemented today versus what is still roadmap-only.

### Done evidence
- passing root command transcript or CI run
- updated root workspace files
- updated root docs

### Out of scope
- implementing product runtime behavior
- building the full CLI or API surface

---

## W0-S02 — Contracts package and schema loader baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Make the documented contracts machine-loadable so profiles, packets, reports, and live E2E assets can be validated through one shared path.
- **Primary modules:** `packages/contracts`, `docs/contracts/**`, `examples/**`
- **Hard dependencies:** W0-S01
- **Primary user-story surfaces:** project bootstrap / onboarding, AI platform owner, reviewer / QA

### Local tasks
1. Implement a first shared contract loader in `packages/contracts` for the core profile and packet families.
2. Map every documented contract in `docs/contracts/00-index.md` to a loader entry or an explicit tracked limitation.
3. Run example files through the same loader path used by later runtime code.
4. Document the contract-loading boundaries and known gaps.

### Acceptance criteria
1. Core project profiles, packets, reports, evaluation assets, and live E2E profiles load through `packages/contracts`.
2. Every contract named in `docs/contracts/00-index.md` has a matching loader entry or an explicit TODO with a limitation note.
3. Example files in `examples/**` resolve through the same loader path rather than ad hoc parsers.
4. Loader failures identify the owning asset and the violated contract family clearly.

### Done evidence
- loader tests or fixture validations
- documented contract-to-loader index
- example load pass report

### Out of scope
- full runtime semantics for every contract field
- LLM-backed validation or eval behavior

---

## W0-S03 — Example and reference integrity checks
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Prevent docs, examples, and contract references from drifting apart before implementation volume increases.
- **Primary modules:** `packages/contracts`, `examples/**`, root validation scripts
- **Hard dependencies:** W0-S02
- **Primary user-story surfaces:** AI platform owner, reviewer / QA, operator / SRE

### Local tasks
1. Build reference checks that verify example refs, bundle refs, wrapper refs, and dataset or suite refs.
2. Check that every referenced asset exists and matches the expected subject type or contract family.
3. Add a repo-level command and CI hook for example or reference integrity.
4. Document the expected failure shapes so agents can fix drift quickly.

### Acceptance criteria
1. The repo can fail fast when an example references a missing or wrong-type asset.
2. Dataset, suite, wrapper, prompt-bundle, route, and policy refs are checked through one reusable path.
3. A broken example or stale ref makes the repository check fail with a readable ownership signal.
4. The integrity check is callable locally and from CI.

### Done evidence
- negative fixtures that prove broken refs fail
- repo-integrity command output
- updated examples or docs where drift was found

### Out of scope
- semantic evaluation of asset quality
- runtime execution against external providers

---

## W0-S04 — Agent guidance and backlog workflow baseline
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Make the repo legible to coding agents and humans by default, with a clear backlog operating model and local guidance hierarchy.
- **Primary modules:** root `AGENTS.md`, `docs/backlog/**`, `.agents/skills/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** AI platform owner, engineering manager / planner, contributor onboarding

### Local tasks
1. Define the shared planning hierarchy as wave → epic → slice → local task.
2. Update root and nested agent guidance so local rules are discoverable and conflict-free.
3. Align the backlog skill with the actual planning documents and implementation workflow.
4. Add contributor-facing guidance for how to pick work and record evidence.

### Acceptance criteria
1. Root guidance explains how to choose work, where source of truth lives, and how local guidance overrides global guidance.
2. The backlog operating model is explicit about slice boundaries, local task derivation, and update rules.
3. The backlog skill matches the actual repo planning model and points to the correct files.
4. At least one contributor-facing doc explains how to start work without extra verbal context.

### Done evidence
- updated root and nested guidance files
- updated backlog skill
- cross-links between roadmap, backlog, and AGENTS docs

### Out of scope
- implementing runtime behavior
- changing live E2E target definitions

---

## W0-S05 — Live E2E profile registry and no-write preflight
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Standardize live rehearsal targets and prove that public-repo runs can be prepared safely before any write-back feature exists.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/orchestrator-core`
- **Hard dependencies:** W0-S02, W0-S03
- **Primary user-story surfaces:** operator / SRE, AI platform owner, security / compliance

### Local tasks
1. Define the machine-readable live E2E profile shape and validate the selected public targets against it.
2. Model no-write preflight behavior: clone, inspect, analyze, validate, verify, and stop.
3. Document per-target safety expectations, prerequisites, and abort conditions.
4. Make the preflight path reusable by bootstrap, quality, and delivery rehearsals.

### Acceptance criteria
1. Live E2E profiles load through the shared contracts path and reference only valid assets.
2. The documented runbooks support a no-write path that never mutates upstream repositories.
3. Each selected target has explicit prerequisites, repo shape notes, and failure-safe defaults.
4. Later waves can reuse the same preflight assumptions instead of re-documenting target setup from scratch.

### Done evidence
- validated live E2E profiles
- updated live E2E runbooks
- documented no-write preflight procedure

### Out of scope
- branch pushes, PR creation, or upstream writes
- full routed execution against real models

---

## W0-S06 — Repository CI and acceptance gates
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Put repo hygiene, guidance coverage, and backlog integrity under continuous enforcement before implementation velocity increases.
- **Primary modules:** root CI config, validation scripts, `docs/**`, community health files
- **Hard dependencies:** W0-S01, W0-S03, W0-S04, W0-S05
- **Primary user-story surfaces:** operator / SRE, repo hygiene, AI platform owner

### Local tasks
1. Add a GitHub Actions CI workflow that runs the root repository checks.
2. Enforce least-privilege workflow permissions, concurrency, and pinned third-party actions.
3. Add missing community-health files needed for a public OSS-style repo.
4. Document what CI currently proves and what later waves will add.

### Acceptance criteria
1. A single CI workflow runs on pull requests, pushes to `main`, and manual dispatch.
2. The workflow uses read-only default permissions and cancels stale in-progress runs for the same ref.
3. Root community-health files exist and are linked from the main repo docs.
4. CI failures map back to actionable repo-integrity checks rather than opaque shell failures.

### Done evidence
- workflow file and helper scripts
- passing local integrity commands
- updated README and CONTRIBUTING docs

### Out of scope
- release publishing automation
- provider-backed runtime test matrices

---
