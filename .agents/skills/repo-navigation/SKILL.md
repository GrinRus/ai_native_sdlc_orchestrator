---
name: repo-navigation
description: Locate the owners and related validation surfaces for an AOR change, including runtime prompt or context edits and contributor guidance.
---

Start with `README.md` and the nearest `AGENTS.md` for the affected files. Use
`docs/architecture/00-repo-layout.md` for document ownership and
`docs/architecture/13-package-and-module-map.md` for implementation ownership;
read only the entries relevant to the request.

- Shared CLI/API lifecycle behavior belongs in
  `packages/orchestrator-core/src/operator-cli/` and
  `packages/orchestrator-core/src/control-plane/`; `apps/cli` and `apps/api`
  provide app surfaces. Trace the caller before changing a facade.
- Public contract changes start at `docs/contracts/00-index.md` and use
  `contract-first-change`. Private rehearsal profiles, contracts, and runbooks
  belong under `scripts/live-e2e/`.
- Prompt wording, runtime skills, and context content start at
  `docs/architecture/15-platform-assets-and-prompt-lifecycle.md`, including its
  authoring and evidence guidance. Runtime assets live under `examples/prompts/`,
  `examples/skills/`, and `examples/context/`; contributor instructions live in
  `AGENTS.md` and `.agents/skills/`.
- New product outcomes use `backlog-workflow` to find the owning slice. A bounded
  bug or maintenance fix can stay outside a feature slice as described in
  `CONTRIBUTING.md`.

Return the owning source, affected callers/contracts/examples, and the applicable
checks from [the validation matrix](../../../CONTRIBUTING.md#validation-by-change-type).
For a navigation or review request, report that map without editing it. For an
implementation request, update only the connected sources needed by the outcome.
