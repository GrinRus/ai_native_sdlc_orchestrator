# Repo layout

## Purpose

This document explains how to navigate the AOR repository and where each kind of change belongs.

## Top-level map

- `README.md` — project positioning, quickstart, repo map, and roadmap entry point.
- `CONTRIBUTING.md` — contributor workflow, PR expectations, and repo-specific rules.
- `LICENSE` — repository license.
- `docs/product/**` — scope, user stories, and project definition.
- `docs/research/**` — external best practices and analytical notes.
- `docs/architecture/**` — operating model, flows, architecture, and module map.
- `docs/contracts/**` — packet, report, profile, evaluation, and API contracts.
- `docs/backlog/**` — roadmap waves, epics, slices, local-task planning model, and dependency graph.
- `docs/ops/**` — installed-user rehearsal runbooks and operator procedures.
- `examples/**` — example profiles, packets, routes, wrappers, prompt bundles, policies, adapters, suites, and proof fixtures.
- `apps/**` — implemented API, CLI, and web surfaces with ongoing roadmap extensions.
- `packages/**` — implemented shared runtime modules with ongoing roadmap extensions.
- `.agents/skills/**` — reusable agent workflows for work inside this repo.
- `.github/**` — CI workflow plus GitHub issue and PR templates.
- `scripts/**` — repository-integrity checks used by local commands and CI.

## Editing rules

- Product change → update `docs/product/**` first.
- Flow or architecture change → update `docs/architecture/**`.
- Schema or config change → update `docs/contracts/**` and matching `examples/**`.
- Roadmap or implementation-order change → update `docs/backlog/**`.
- Operator flow or internal public-target rehearsal change → update `docs/ops/**`.
- Community-health or CI change → update `.github/**`, `README.md`, and `CONTRIBUTING.md` together when appropriate.
- Repo-integrity command change → update `scripts/**` and the docs that describe the command behavior.

## What is not source of truth

- runtime state in `.aor/`
- ad hoc scratch notes
- copied prompt text outside the platform-asset docs
- stale local task notes that disagree with the owning slice document
