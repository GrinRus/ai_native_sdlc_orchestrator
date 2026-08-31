# AOR

**AI-native orchestration for the full software delivery lifecycle.**

[![CI](https://github.com/GrinRus/ai_native_sdlc_orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/GrinRus/ai_native_sdlc_orchestrator/actions/workflows/ci.yml)
[![npm alpha](https://img.shields.io/npm/v/%40grinrus%2Faor/alpha?label=npm%20alpha)](https://www.npmjs.com/package/@grinrus/aor)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

AOR is an open-source, local-first control plane for AI-assisted software
delivery. It coordinates existing coding runners across discovery,
specification, planning, execution, review, QA, delivery, release, and learning
while keeping scope, approvals, and evidence explicit.

**AOR coordinates coding agents; it does not replace them.**

```text
Code source + plain-language task -> Read-only preparation -> Confirm -> Work -> Review
```

> **Alpha:** AOR is for evaluation and bounded local or self-hosted use. It is
> not a production-ready general-purpose orchestrator. Start with `no-write`
> mode and a disposable repository.

[Quickstart](#run-your-first-task) ·
[Safety](#safety-model) ·
[How it works](#how-aor-works) ·
[Documentation](#documentation) ·
[Contributing](#contributing)

![AOR Task Workspace](https://raw.githubusercontent.com/GrinRus/ai_native_sdlc_orchestrator/main/docs/product/assets/w70-task-workspace-console/01-tasks-home.png)

## Why AOR?

Coding runners are good at reasoning, editing files, and using tools inside a
task. AOR provides the control layer around those tasks: it carries project
context across the lifecycle, chooses bounded routes, validates durable
artifacts, applies policy and approval gates, and records what happened before
delivery is allowed.

| Coding runner | AOR |
| --- | --- |
| Executes one bounded step | Coordinates the end-to-end delivery flow |
| Reasons over code and tools | Owns scope, policy, budgets, and approvals |
| Produces an implementation result | Preserves packets, reports, decisions, and lineage |
| May be provider-specific | Keeps the core runner-agnostic through adapters |

AOR is:

- **Bounded by default.** Every step has explicit scope, commands, budgets, and
  write-back mode.
- **Evidence-first.** Packets and reports make state, decisions, and handoffs
  inspectable and traceable.
- **Validation before evaluation.** Deterministic contract checks run before
  semantic or judge-based quality checks.
- **Safe by default.** `no-write`, `patch-only`, `local-branch`, and
  `fork-first-pr` make delivery intent explicit; upstream writes are off by
  default.
- **Headless-first.** The CLI and control-plane runtime work without the
  optional local web console.

Use AOR to study or operate a controlled SDLC around repositories you are
allowed to inspect. Do not expect it to replace your coding agent, CI system,
issue tracker, or release platform.

## Requirements

For the installed CLI:

- Node.js `>=22`;
- a local repository you are allowed to inspect;
- for AI-backed preparation or execution, a supported runner binary with its
  normal authentication already configured.

For source development, also use Corepack and the repository-pinned pnpm
`10.12.4`. AOR does not install or authenticate Codex CLI, Claude Code,
OpenCode, Qwen Code, or custom runners.

## Install the npm alpha

Resolve the alpha tag explicitly so npm does not select the older `latest`
dist-tag:

```bash
AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"
npm install -g "@grinrus/aor@$AOR_VERSION"
aor --help
```

The package includes the CLI, bundled onboarding assets, and the local web
console used by `aor app`. The npm alpha is a tagged snapshot and may not yet
include unreleased features visible on `main`.

<details>
<summary>Install from source</summary>

```bash
git clone https://github.com/GrinRus/ai_native_sdlc_orchestrator.git
cd ai_native_sdlc_orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm aor --help
```

Source-checkout examples use `pnpm aor`; installed-package examples use
`aor`.

</details>

## Run your first task

Start the packaged local console:

```bash
aor app
```

`aor app` starts a foreground server on `127.0.0.1`, opens the browser, and
prints its URL. Press `Ctrl+C` to stop it.

In the Task Workspace:

1. Select or connect a project.
2. Choose **New task**, describe the outcome, and optionally add Markdown
   source material.
3. Choose **Prepare task**. Preparation is read-only and does not authorize
   source changes.
4. Review the prepared outcome, acceptance criteria, scope, runner, and safety
   mode.
5. Choose **Start task**, then follow activity, attention, changes, checks, and
   evidence through completion.

AI-backed preparation requires one authenticated ready runner. All mutable AOR
state is stored under `~/.aor` (or `AOR_HOME` for isolated runs), never in
the target repository. Repository writes occur only through explicit
**Materialize project config** or selected evidence export actions; AOR never
stages, commits, or pushes those files.

From an active Task, **Ask AOR** creates a durable operator request rather than
a direct chat session. It passes through the same scope, policy, and
evidence-producing runtime as CLI and API execution.

### Credential-free UI smoke

Use smoke mode to verify the packaged UI without runner credentials:

```bash
TARGET_REPO=/path/to/disposable-repository
aor app --project-ref "$TARGET_REPO" --smoke --open false --json
```

The command should return `status: "smoke-pass"`. On a clean target, app smoke
should pass without creating repo-local `.aor/`.

<details>
<summary>Headless source-checkout quickstart</summary>

```bash
pnpm aor project connect --path /path/to/local-project --json
pnpm aor task prepare \
  --project-id <workspace-project-id> \
  --request "Review authorization and fix timeout handling" \
  --file requirements.md \
  --json
pnpm aor task start \
  --submission-id <submission-id> \
  --json
```

</details>

<details>
<summary>Verify the published npm package</summary>

Run registry smoke from a neutral temporary runner directory so the source
checkout cannot shadow the registry package:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/target" "$TMP/runner"
git -C "$TMP/target" init
cd "$TMP/runner"
AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"

npm exec --yes --package "@grinrus/aor@$AOR_VERSION" -- aor --help

npm exec --yes --package "@grinrus/aor@$AOR_VERSION" -- \
  aor app --project-ref "$TMP/target" --smoke --open false --json
```

Do not run this registry-package smoke from the AOR source checkout. npm can
prefer the local package context and produce a misleading
`aor: command not found` result.

</details>

## What you should see

Tasks Home keeps prepared, active, attention, ready, and completed work
resumable. Each Task moves through explicit preparation, activity, change
review, checks, and completion evidence without moving lifecycle ownership into
the browser.

The installed journey is:

```text
Project -> Task -> Prepare -> Start -> Work -> Review -> Complete
```

## Safety model

- `~/.aor` is private mutable state and must not be committed.
- Repo-local `.aor` is reserved for explicit portable config and selected
  evidence exports; legacy runtime content is not loaded or deleted.
- Prepare is read-only. Patch-capable execution starts only after confirmation,
  and upstream writes are never enabled automatically.
- Delivery modes, allowed paths, commands, budgets, and approvals remain
  explicit in runtime evidence.
- Raw runner output and credential-bearing artifacts are private evidence, not
  normal CLI, API, or web projections.

Read the [self-hosted release model](docs/ops/self-hosted-release.md) and
[secrets and redaction guide](docs/ops/self-hosted-secrets-and-redaction.md)
before credentialed or write-capable operation.

## Current alpha status

The repository is docs-first with implemented CLI, API, web, and runtime
baselines. The current audience is early operators, contributors, and
researchers.

| Surface | Current state |
| --- | --- |
| GitHub `main` | Current source and design baseline; may contain unreleased work |
| npm `@alpha` | Latest tagged CLI snapshot; can lag behind `main` |
| Installed UI | Task Workspace with task preparation, work, review, and evidence |
| Production readiness | Audit hold; no general production clearance |
| Supported operating shape | Bounded local/self-hosted use on Node.js 22 |

Development acceptance and release qualification are separate. W69 and W70 are development-complete, and the Task Workspace is available through the npm
`@alpha` channel. W66 remains the release-qualification blocker: fresh
same-commit required-provider evidence is incomplete, so the current
disposition remains `audit-hold` with `release_clearance=false`.

Run `pnpm check` for repository integrity. Maintainers use
`pnpm production:ready --json` for the separate release disposition.

The supported alpha does not include hosted SaaS, Windows certification,
enterprise identity/SSO, credentialed provider certification, paid calls,
default upstream writes, or automatic upstream publication of
target-repository changes.

There is no Docker or GHCR version channel yet. Only the root CLI package
`@grinrus/aor` is published; internal workspace packages stay `private:true`
and are not public semver APIs. The source-channel version truth is
`package.json`; the npm-channel truth is the registry `alpha` dist-tag. The
release process is documented in
[`docs/ops/npm-cli-alpha-release.md`](docs/ops/npm-cli-alpha-release.md).

## How AOR works

```text
Project + Task
      |
      v
read-only preparation -> review and confirm
      |
      v
bounded route + adapter -> coding runner
      |
      v
packets, reports, and runtime evidence
      |
      v
deterministic validation -> evaluation -> review/QA
      |
      v
delivery policy -> no-write | patch | local branch | fork-first PR | blocked
```

See the [operating model](docs/architecture/12-orchestrator-operating-model.md)
for the canonical lifecycle and ownership boundaries.

## Runners

Runner binaries, authentication, and normal credential stores remain outside
AOR. `mock-runner` supports deterministic tests; Codex CLI and Claude Code have
adapters but await fresh W66 qualification. OpenCode and Qwen Code remain
candidate coverage. An adapter profile declares capability; it does not prove
that a runner is installed, authenticated, safe, or release-qualified.

## Artifacts and interfaces

The common mutable layout is:

```text
${AOR_HOME:-$HOME/.aor}/projects/<workspace-project-id>/
  artifacts/   packets and generated evidence
  reports/     decisions, summaries, and quality evidence
  state/       project and task runtime state
```

Treat AOR Home as sensitive machine-local state. Do not paste
credential-bearing artifacts or private repository evidence into public issues.

AOR remains headless-first. `aor app` launches the packaged Task Workspace on
literal loopback; [`apps/web`](apps/web) contains the React/Vite console,
[`apps/api`](apps/api) exports the control-plane API, and
[`packages/orchestrator-core`](packages/orchestrator-core) owns the shared
lifecycle. See the
[`control-plane API contract`](docs/contracts/control-plane-api.md) for the
HTTP/SSE surface.

These are local alpha surfaces, not a hosted product claim. Browser
authentication, multi-tenant isolation, remote UI connectivity, and enterprise
identity/SSO are outside the supported mode.

The CLI command surface currently includes **73 implemented** commands and **0 planned** commands. See the
[CLI command catalog](docs/architecture/14-cli-command-catalog.md) for flags,
outputs, and contract families.

## When not to use AOR yet

Do not use AOR yet if you need:

- stable GA packages or supported public SDK APIs;
- Docker or GHCR images;
- Hosted SaaS, managed accounts, or enterprise identity/SSO;
- broad, currently certified parity across arbitrary runners;
- Default upstream write-back automation;
- unattended production automation for critical repositories;
- guaranteed support or incident-response SLAs.

## Documentation

| If you want to... | Start here |
| --- | --- |
| Understand the product | [Project description](docs/product/01-project-description.md) |
| Follow the installed-user path | [First-run guide](docs/ops/installed-user-first-run.md) |
| Understand the runtime | [Orchestrator operating model](docs/architecture/12-orchestrator-operating-model.md) |
| Inspect system contracts | [Contracts index](docs/contracts/00-index.md) |
| Explore the CLI | [Command catalog](docs/architecture/14-cli-command-catalog.md) |
| Understand package boundaries | [Package and module map](docs/architecture/13-package-and-module-map.md) |
| Operate the alpha safely | [Operations index](docs/ops/00-runbook-index.md) |
| Follow current work | [MVP roadmap](docs/backlog/mvp-roadmap.md) |

W70 is the latest defined development wave and owns the Task Workspace
implementation history. W66 remains the independent release-qualification
blocker. Architecture decisions live in
[`docs/architecture/adr`](docs/architecture/adr), implementation slices in
[`docs/backlog`](docs/backlog), and runnable contract examples in
[`examples`](examples).

## Contributing

Use this path when changing AOR rather than operating it against a target:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` is the default commit-ready repository gate. Run
`pnpm production:ready --json --allow-audit-hold` only when
production-readiness or release evidence is in scope.

Before opening a pull request:

- read [CONTRIBUTING.md](CONTRIBUTING.md) and the nearest
  [`AGENTS.md`](AGENTS.md);
- keep docs, contracts, examples, and code aligned;
- use one roadmap slice when implementation introduces a new product outcome;
- keep tightly scoped bug, documentation, and maintenance fixes explicit
  without manufacturing a new slice;
- never commit `.aor/`, credentials, generated target checkouts, or runner
  transcripts.

Use the
[bug report](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues/new?template=bug-report.md)
or
[feature request](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues/new?template=feature-request.md)
template, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainers and governance

AOR is currently maintained by
[`GrinRus`](https://github.com/GrinRus). Repository ownership is recorded in
[`.github/CODEOWNERS`](.github/CODEOWNERS); roadmap and contract changes are
reviewed through focused pull requests against their source-of-truth documents.
Support remains best-effort during alpha.

## Security and support

Read [SECURITY.md](SECURITY.md) and use GitHub Private Vulnerability Reporting
for vulnerabilities or possible secret exposure. Never publish credentials,
private repository contents, exploit details, or sensitive `.aor/` artifacts
in an issue or pull request.

Use [GitHub issues](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues)
for reproducible bugs, documentation gaps, and feature requests; see
[SUPPORT.md](SUPPORT.md) for supported channels and current limits.

## License

AOR is licensed under the [Apache License 2.0](LICENSE). Attribution notices are
available in [NOTICE](NOTICE).
