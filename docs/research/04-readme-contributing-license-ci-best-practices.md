# README, CONTRIBUTING, license, and CI best practices

## Purpose

This note records the external references used to refresh the AOR root README, contributor workflow, license choice, and GitHub Actions setup.

## README patterns from popular open-source AI projects

### Continue

Reference: [continuedev/continue README](https://github.com/continuedev/continue/blob/main/README.md)

Useful patterns adopted for AOR:

- a short one-line project statement near the top;
- a quick “getting started” entry point;
- a simple “how it works” explanation before deeper implementation detail;
- short links to contribution and license information from the root README.

### LangChain.js

Reference: [langchain-ai/langchainjs README](https://github.com/langchain-ai/langchainjs/blob/main/README.md)

Useful patterns adopted for AOR:

- clear positioning for what the project is;
- a “why use this project?” section instead of jumping directly into implementation details;
- an explicit quick install or quick start block;
- a compact explanation of adjacent project surfaces and ecosystem boundaries.

### Browser Use

Reference: [browser-use/browser-use README](https://github.com/browser-use/browser-use/blob/main/README.md)

Useful patterns adopted for AOR:

- separate entry points for different audiences;
- strong task-oriented quickstarts;
- a practical “current use vs future/platform use” explanation;
- examples and operator-oriented sections grouped after the quickstart rather than before it.

## CONTRIBUTING patterns

### GitHub guidance

Reference: [GitHub Docs — Setting guidelines for repository contributors](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)

Key takeaways:

- put `CONTRIBUTING.md` in the repository root, `docs`, or `.github`;
- contribution guidelines should help contributors submit well-formed PRs and useful issues;
- GitHub surfaces the contributing guide automatically when the file is in the expected location.

### LangChain.js

Reference: [langchain-ai/langchainjs CONTRIBUTING](https://github.com/langchain-ai/langchainjs/blob/main/CONTRIBUTING.md)

Useful patterns adopted for AOR:

- fork-and-PR workflow;
- separate paths for bug reports, feature requests, docs work, and code contributions;
- keep PRs focused;
- run local checks before pushing;
- update docs when public behavior changes.

### Continue

Reference: [continuedev/continue CONTRIBUTING](https://github.com/continuedev/continue/blob/main/CONTRIBUTING.md)

Useful patterns adopted for AOR:

- explicit contributor entry points;
- practical bug-report guidance;
- concrete contribution ideas for new contributors.

### OpenAI Codex

Reference: [openai/codex contributing guide](https://github.com/openai/codex/blob/main/docs/contributing.md)

Useful patterns adopted for AOR:

- keep contribution scope explicit;
- keep commits and PRs focused;
- document behavior changes together with code;
- treat tests and user-facing docs as part of the change, not as an afterthought.

## License choice

### Why AOR now uses Apache-2.0

References:

- [GitHub Docs — Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [Choose a License — Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/)
- [openai/codex repository](https://github.com/openai/codex)
- [continuedev/continue repository](https://github.com/continuedev/continue)
- [langchain-ai/langchainjs repository](https://github.com/langchain-ai/langchainjs)
- [All-Hands-AI/OpenHands repository](https://github.com/All-Hands-AI/OpenHands)

Reasoning:

- public code should carry an explicit open-source license rather than relying on default copyright;
- Apache-2.0 is permissive and includes an express patent grant;
- similar open-source AI developer tools commonly choose either Apache-2.0 or MIT;
- for AOR, Apache-2.0 is a good fit because the project is infrastructure-like, adapter-heavy, and intended for broad reuse.

## GitHub Actions patterns

### GitHub guidance

References:

- [GitHub Actions docs](https://docs.github.com/en/actions)
- [GitHub Docs — Building and testing Node.js](https://docs.github.com/actions/guides/building-and-testing-nodejs)
- [GitHub Docs — Control the concurrency of workflows and jobs](https://docs.github.com/enterprise-cloud%40latest/actions/using-jobs/using-concurrency)
- [GitHub Docs — Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

Key takeaways:

- use GitHub Actions as the standard CI entry point;
- declare explicit `permissions` instead of relying on broad defaults;
- use `concurrency` to cancel stale runs on the same branch or PR when appropriate;
- pin third-party actions to full commit SHAs for immutability and supply-chain safety.

### Open-source examples

References:

- [openai/codex `.github/workflows/ci.yml`](https://github.com/openai/codex/blob/main/.github/workflows/ci.yml)
- [langchain-ai/langchainjs `.github/workflows/ci.yml`](https://github.com/langchain-ai/langchainjs/blob/main/.github/workflows/ci.yml)

Useful patterns adopted for AOR:

- top-level `permissions: contents: read` for read-only CI;
- workflow-level concurrency to cancel stale in-progress runs;
- pinned action SHAs;
- a simple build / lint / test CI loop rather than over-engineered multi-job automation at the scaffold stage.

## Resulting repo changes

Based on the references above, AOR now includes:

- a clearer root README with project positioning, quickstarts, repo map, roadmap entry points, and current vs planned behavior;
- a root `CONTRIBUTING.md` aligned with the slice-first backlog model;
- an Apache-2.0 `LICENSE`;
- a pinned, least-privilege GitHub Actions CI workflow;
- issue and PR templates aligned with the slice-first contribution style.
