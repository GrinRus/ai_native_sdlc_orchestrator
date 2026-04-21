# AGENTS.md and live E2E best practices

## Why this document exists
This note records two operational decisions for the AOR repository:
1. how agent-facing repository guidance should be written;
2. which public GitHub repositories we use for live E2E rehearsals.

## AGENTS.md best practices we adopted

### Keep the root file short and practical
The root `AGENTS.md` is intentionally lightweight. It explains the project, the accurate current commands, the repo map, the working rules, and the definition of done. It does **not** duplicate the full architecture.

### Use nested AGENTS files for local rules
AOR now uses module-level `AGENTS.md` files in `apps/*`, `packages/*`, and `docs/ops`. This follows the "closest instructions win" model and keeps local guidance near the code the agent edits.

### Prefer pointers over context bloat
The root file points agents to the right source-of-truth documents instead of embedding the entire architecture. This reduces context noise and keeps instructions maintainable.

### Add reusable skills for repeated workflows
AOR now ships root skills for repository navigation, contract-first changes, backlog work, story traceability, and live E2E preflight. This keeps the main `AGENTS.md` small while still giving agents reusable task-specific playbooks.

## Live E2E target-selection criteria
We selected public repositories that are:
- real projects rather than toy demos;
- easy to clone and run locally;
- diverse in shape and stack;
- safe to rehearse against through forks or patch output;
- representative of the kinds of projects AOR must support.

## Selected target repositories

### 1. `sindresorhus/ky`
Use for short library rehearsals. It is small, modern, well-bounded, and exposes a clear `npm test` path.

### 2. `httpie/cli`
Use for deeper regression rehearsals. It exercises Python, CLI workflows, `make`-driven setup, and stronger local verification.

### 3. `belgattitude/nextjs-monorepo-example`
Use for long release rehearsals. It exercises a public monorepo with apps, packages, workspace-wide checks, and realistic dependency boundaries.

## Scenario mapping
- `regress short` → `sindresorhus/ky`
- `regress long` → `httpie/cli`
- `release short` → `sindresorhus/ky`
- `release long` → `belgattitude/nextjs-monorepo-example`

## Sources
- [OpenAI Codex: Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI Codex: Best practices](https://developers.openai.com/codex/learn/best-practices)
- [OpenAI Codex: Skills](https://developers.openai.com/codex/skills)
- [AGENTS.md open format](https://agents.md/)
- [Anthropic: Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [sindresorhus/ky](https://github.com/sindresorhus/ky)
- [raw package.json for ky](https://raw.githubusercontent.com/sindresorhus/ky/main/package.json)
- [httpie/cli](https://github.com/httpie/cli)
- [httpie/cli CONTRIBUTING.md](https://github.com/httpie/cli/blob/master/CONTRIBUTING.md)
- [raw Makefile for httpie/cli](https://raw.githubusercontent.com/httpie/cli/master/Makefile)
- [belgattitude/nextjs-monorepo-example](https://github.com/belgattitude/nextjs-monorepo-example)
- [raw package.json for belgattitude/nextjs-monorepo-example](https://raw.githubusercontent.com/belgattitude/nextjs-monorepo-example/main/package.json)
