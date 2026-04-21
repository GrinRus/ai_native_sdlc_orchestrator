# Critical review of the plan

## What is already strong
- The project has a clear packet-first and contract-first identity.
- The control-plane model separates orchestration from runners.
- Eval and harness are treated as default parts of the runtime.
- Delivery is modeled explicitly through a delivery manifest.
- The repo is structured around product, architecture, contracts, ops, examples, and code scaffolding.

## Risks that still need active attention

### 1. Documentation can drift from examples
AOR is heavily contract-driven. If docs change without examples, or examples change without contracts, trust drops quickly.

### 2. Platform-asset evolution can become too loose
Prompt bundles, wrappers, routes, and adapters are powerful. Without explicit promotion, freeze, and rollback paths, a "small prompt tweak" can behave like a production release without the right discipline.

### 3. Live E2E can become ad hoc
Without a fixed target catalog and safety policy, live E2E risks turning into one-off demos. The public-repo target catalog in `docs/ops/live-e2e-target-catalog.md` is meant to prevent that.

### 4. The root AGENTS file can become too large
AGENTS files are only useful when they stay accurate and concise. The repo now uses nested AGENTS plus reusable skills to avoid context bloat.

### 5. Multirepo support can sprawl
Bounded multirepo support is valuable, but MVP should stay explicit about impacted repos, locks, and delivery coordination. It should not drift into organization-wide autonomous orchestration.

## Follow-up actions baked into the cleaned v1 repo
- keep agent guidance lightweight and local;
- keep implementation work aligned to the backlog waves;
- keep public-repo live E2E fork-first and evidence-heavy;
- keep contract docs and examples updated together;
- keep the web UI detachable.
