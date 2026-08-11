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
Code source + plain-language intent -> Read-only preparation -> Confirm -> Flow
```

> **Alpha:** AOR is for evaluation and bounded local or self-hosted use. It is not
> a production-ready general-purpose orchestrator. Start with `no-write` mode
> and a disposable repository.

[Quickstart](#run-your-first-no-write-local-mission) ·
[How it works](#how-aor-works) ·
[Documentation](#docs-map) ·
[Contributing](#contributing) ·
[Roadmap](#roadmap)

## What is AOR?

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

AOR is built around a few principles:

- **Bounded by default.** Every step has explicit scope, commands, budgets, and
  write-back mode.
- **Evidence-first.** Packets and reports make state, decisions, and handoffs
  inspectable and traceable.
- **Validation before evaluation.** Deterministic contract checks run before
  semantic or judge-based quality checks.
- **Safe delivery.** `no-write`, `patch-only`, `local-branch`, and
  `fork-first-pr` make delivery intent explicit; upstream writes are off by
  default.
- **Headless-first.** The CLI and control-plane runtime work without the
  optional local web console.

Use AOR to study or operate a controlled SDLC around repositories you are
allowed to inspect. Do not expect it to replace your coding agent, CI system,
issue tracker, or release platform.

## Status: alpha distribution

The repository is docs-first with implemented CLI, API, web, and runtime
baselines. The current audience is early operators, contributors, and
researchers.

| Surface | Current state |
| --- | --- |
| GitHub `main` | Current source and design baseline; may contain unreleased work |
| npm `@alpha` | Latest tagged CLI snapshot; can lag behind `main` |
| Production readiness | Audit hold; no general production clearance |
| Supported operating shape | Bounded local/self-hosted use on Node.js 22 |

W30 established the alpha hardening boundary. Later audit remediation closed
historical findings, but the W66 qualification intake invalidated that historical
release clearance until fresh same-commit Codex and Claude qualification is
complete. Run `pnpm check` before `pnpm production:ready --json`; the current W66
disposition remains `audit-hold` with `release_clearance=false`.

The supported alpha does not include hosted SaaS, Windows certification,
enterprise identity, credentialed provider certification, paid calls, default
upstream writes, or automatic upstream publication of target-repository
changes.

W67 defines the breaking central-AOR-Home and intent-first onboarding cutover;
W68 defines provider-neutral runtime model and reasoning-effort selection.
W69 defines intent-first confirmation CAS, runtime-owned adaptive Flow
projections, resume-safe Project Home navigation, review-first Prepared Task,
and Flow Cockpit UI parity without changing the historical W66 provider hold.
Its implementation candidate is present, while formal slice completion remains
backlog-blocked behind the W66-S20-S25 runner-output remediation chain and the
subsequent W66-S09 qualification closure.

W70 defines the blocked successor design and implementation lane for a
Task-first installed workspace: Tasks Home, safe Markdown sources, truthful
task runner selection, active work, Attention, change review, and completion
evidence. It starts only after W69 closes and does not change the W66 provider
qualification hold.

Mutable AOR data lives in `~/.aor`; `AOR_HOME` is reserved for isolated tests
and rehearsals. Runner forks can be selected without shell aliases:

```bash
export AOR_RUNNER_COMMAND_CLAUDE_CODE=tclaude
export AOR_RUNNER_COMMAND_QWEN_CODE=nessy
```

Authentication remains owned by the selected executable and its normal
credential store or agent.

## Current distribution channels

| Channel | Use it for | Source of version truth |
| --- | --- | --- |
| [GitHub `main`](https://github.com/GrinRus/ai_native_sdlc_orchestrator) | Evaluating or contributing to current source | `package.json` in the checkout |
| [npm `@alpha`](https://www.npmjs.com/package/@grinrus/aor) | Trying the latest tagged CLI release | npm `alpha` dist-tag |

There is no Docker or GHCR version channel yet. Only the root CLI package
`@grinrus/aor` is published; internal workspace packages stay `private:true`
and are not public semver APIs. The release process is documented in
[`docs/ops/npm-cli-alpha-release.md`](docs/ops/npm-cli-alpha-release.md).

## Requirements

For the installed CLI:

- Node.js `>=22`;
- a local repository you are allowed to inspect;
- if you use a live runner, its binary and authentication.

For source development, also use Corepack and the repository-pinned pnpm
`10.12.4`. AOR does not install or authenticate Codex CLI, Claude Code,
OpenCode, Qwen Code, or custom runners.

## Install CLI from npm alpha

Resolve the alpha tag explicitly so npm does not select the older `latest`
dist-tag:

```bash
AOR_VERSION="$(npm view @grinrus/aor dist-tags.alpha)"
npm install -g "@grinrus/aor@$AOR_VERSION"
aor --help
```

The package includes the CLI, bundled onboarding assets, and the local web
console used by `aor app`. The npm alpha is a tagged snapshot and may not yet
include features visible on `main`.

## Clone and install from source

Use this path to evaluate current source or contribute to AOR itself:

```bash
git clone https://github.com/GrinRus/ai_native_sdlc_orchestrator.git
cd ai_native_sdlc_orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm aor --help
```

Source-checkout examples use `pnpm aor`; installed-package examples use `aor`.

## Run your first no-write local mission

Connect a disposable local repository and let the browser prepare the task:

```bash
aor app
```

`aor app` starts a foreground server on `127.0.0.1`, opens the local console,
and prints its URL. Press `Ctrl+C` to stop it. In the first-run wizard:

1. Choose a local Git folder or enter an HTTPS/SSH Git URL.
2. Enter the intent and optionally attach `.txt`, `.md`, `.json`, or YAML files.
3. Select **Prepare task** for read-only AI normalization.
4. Review acceptance, scope, provider, and safety mode, then select
   **Confirm and start**.

Preparation requires one authenticated ready runner. All mutable AOR state is
stored under `~/.aor` (or `AOR_HOME` for isolated runs), never in the target
repository. Repository writes occur only through explicit **Materialize project
config** or selected evidence export actions; AOR never stages, commits, or
pushes those files.

From a flow stage, **Ask AOR** creates a durable operator request rather than a
direct chat session. The request is validated against its target refs, allowed
paths, and delivery mode, then routed through the same evidence-producing
runtime used by CLI and API execution.

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
prefer the local package context and produce a misleading `aor: command not
found` result.

</details>

First-run safety notes:

- `~/.aor` is private mutable state and must not be committed.
- Repo-local `.aor` is reserved for explicit portable config and selected
  evidence exports; legacy runtime content is not loaded or deleted.
- Prepare is read-only. Patch-capable execution starts only after confirmation,
  and upstream writes are never enabled automatically.

## What you should see

- Source connect derives the workspace ID, stable mount, topology, components,
  and verification suggestions.
- Prepare stores an immutable submission and creates a validated preview.
- Confirm creates exactly one flow and starts its first executable action.
- `aor app` shows the project, current flow, lifecycle stage, blockers, and
  evidence without owning the underlying lifecycle in the browser.

For deterministic UI verification, run:

```bash
aor app --project-ref "$TARGET_REPO" --smoke --open false --json
```

On a clean target, app smoke should pass without creating repo-local `.aor/`.

## How AOR works

```text
Project profile + Mission
          |
          v
  bounded lifecycle step
          |
          +--> route + adapter --> coding runner
          |                         |
          |                         v
          +<-- packets, reports, and runtime evidence
          |
          v
 deterministic validation --> evaluation --> review/QA
          |
          v
 delivery policy --> patch | local branch | fork-first PR | blocked
          |
          v
 release evidence --> incidents, datasets, and recertification
```

The core objects are:

| Object | Role |
| --- | --- |
| **Project** | Repository topology, policies, budgets, and write-back rules |
| **Mission / Flow** | One outcome and its end-to-end evidence lineage |
| **Packet / Report** | Durable, contract-validated handoff or decision artifact |
| **Route / Adapter** | Provider-neutral runner selection and invocation boundary |
| **Runtime Harness** | Execute, classify, validate, retry or repair, verify, and close |
| **Delivery mode** | Explicit boundary for no-write, patch, branch, or fork-first delivery |

See the [operating model](docs/architecture/12-orchestrator-operating-model.md)
for the canonical lifecycle and ownership boundaries.

## Choose a runner

Runner binaries and credentials are configured outside AOR.

| Runner path | Current fit |
| --- | --- |
| `mock-runner` | Deterministic local tests and credential-free rehearsals |
| `codex-cli` | Adapter available; fresh W66 qualification is pending |
| `claude-code` | Adapter available; fresh W66 qualification is pending |
| `open-code` and `qwen-code` | Candidate adapter coverage, not a required public baseline |
| Custom adapters | Contract and authoring path; internal packages are not stable public SDKs |

Treat an adapter profile as a capability declaration, not a guarantee that a
third-party runner is installed, authenticated, safe for your repository, or
currently release-qualified.

## Inspect artifacts

JSON output returns logical artifact and report references when files are
written. The common mutable layout is:

```text
${AOR_HOME:-$HOME/.aor}/projects/<workspace-project-id>/
  artifacts/   packets and generated evidence
  reports/     decisions, summaries, and quality evidence
  state/       project and flow runtime state
```

Treat AOR Home as sensitive machine-local state. Repo-local `.aor/` is reserved
for explicitly materialized portable configuration and selected exports; do
not paste credential-bearing artifacts or private repository evidence into
public issues.

## Optional API/web surfaces

AOR is headless-first: the CLI and control-plane runtime remain usable without
the web console.

- `aor app` launches the packaged local SPA on literal loopback.
- [`apps/web`](apps/web) contains the React/Vite operator console.
- [`apps/api`](apps/api) exports the API surface; shared HTTP/SSE transport lives
  in [`packages/orchestrator-core`](packages/orchestrator-core).
- The API contract is documented in
  [`docs/contracts/control-plane-api.md`](docs/contracts/control-plane-api.md).

These are local alpha surfaces, not a hosted product claim. Browser
authentication, multi-tenant isolation, remote UI connectivity, and
enterprise identity/SSO are outside the supported mode.

## What works today

| Capability | Current source status |
| --- | --- |
| npm CLI distribution | Published alpha snapshots |
| Repository onboarding and readiness diagnostics | Implemented baseline |
| Mission intake and evidence-backed next actions | Implemented baseline |
| Quiet Cockpit local operator console | Implemented on `main`; npm alpha may lag |
| Durable operator requests | Implemented baseline |
| CLI, API, contracts, adapters, and runtime harness | Implemented baseline |
| Single-repo, monorepo-component, and bounded multirepo planning | Implemented baseline |
| Production-readiness disposition | Implemented gate; current W66 result is audit hold |

"Implemented baseline" means that source, contracts, and automated evidence
exist. It does not mean GA stability, broad provider parity, or unattended
production certification.

## Command surface status

The CLI command surface currently includes **72 implemented** commands and **0 planned** commands. See the [CLI command catalog](docs/architecture/14-cli-command-catalog.md) for flags, outputs, and contract families.

## Readiness evidence

`pnpm check` validates repository integrity across docs, examples, contracts,
command surfaces, tests, package metadata, and release policy. It is not a
production certification.

`pnpm production:ready --json` is a separate maintainer-facing disposition
gate. The current W66 `audit-hold` may clear only after committed qualification
evidence satisfies the gate. Read the
[production-readiness guide](docs/ops/production-readiness-gate.md) and the
[bounded self-hosted release model](docs/ops/self-hosted-release.md) before any
credentialed or write-capable use.

## When not to use AOR yet

Do not use AOR yet if you need:

- stable GA packages or supported public SDK APIs;
- Docker or GHCR images;
- Hosted SaaS, managed accounts, or enterprise identity/SSO;
- broad, currently certified parity across arbitrary runners;
- Default upstream write-back automation;
- unattended production automation for critical repositories;
- guaranteed support or incident-response SLAs.

## Docs map

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

Architecture decisions live in
[`docs/architecture/adr`](docs/architecture/adr), implementation slices in
[`docs/backlog`](docs/backlog), and runnable contract examples in
[`examples`](examples).

## Contributor quickstart

Use this path when changing AOR rather than operating it against a target:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm production:ready --json --allow-audit-hold
```

The explicit hold allowance keeps the current W66 disposition visible without
turning the known audit hold into a contributor setup failure. Report both the
integrity result and the readiness disposition in your pull request.

Before opening a pull request:

- read [CONTRIBUTING.md](CONTRIBUTING.md) and the nearest
  [`AGENTS.md`](AGENTS.md);
- keep docs, contracts, examples, and code aligned;
- keep changes scoped to one roadmap slice when implementation is involved;
- never commit `.aor/`, credentials, generated target checkouts, or runner
  transcripts.

## Repository map

```text
apps/
  cli/                 CLI entrypoint and command surface
  api/                 control-plane API export surface
  web/                 optional local operator console
packages/
  orchestrator-core/   lifecycle, state, control-plane, and delivery logic
  contracts/           contract loaders and shared identifiers
  adapter-sdk/         internal adapter authoring implementation
  provider-routing/    provider-neutral route resolution
  harness/             capture, replay, and certification primitives
  observability/       events, metrics, and audit projections
docs/
  product/             supported outcomes and product definition
  architecture/        runtime behavior and system boundaries
  contracts/           durable schema and interface source of truth
  backlog/             roadmap, waves, epics, and slices
  ops/                 operator and maintainer runbooks
examples/              profiles, packets, reports, policies, and adapters
scripts/               repository-integrity and release checks
```

## Roadmap

The [MVP roadmap](docs/backlog/mvp-roadmap.md) and
[`docs/backlog/wave-66-implementation-slices.md`](docs/backlog/wave-66-implementation-slices.md)
are the planning sources of truth. The current lane focuses on restoring fresh
provider qualification while preserving bounded execution, contract alignment,
and no-upstream-write defaults.

## Contributing

Contributions are welcome through focused issues and pull requests. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), use the
[bug report](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues/new?template=bug-report.md)
or [feature request](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues/new?template=feature-request.md)
template, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security and responsible disclosure

Read [SECURITY.md](SECURITY.md) and use GitHub Private Vulnerability Reporting
for vulnerabilities or possible secret exposure. Never publish credentials,
private repository contents, exploit details, or sensitive `.aor/` artifacts in
an issue or pull request.

## Support

Support is best-effort during alpha. Use [GitHub issues](https://github.com/GrinRus/ai_native_sdlc_orchestrator/issues)
for reproducible bugs, documentation gaps, and feature requests; see
[SUPPORT.md](SUPPORT.md) for the supported channels and current limits.

## License

AOR is licensed under the [Apache License 2.0](LICENSE). Attribution notices are
available in the source repository's
[NOTICE](https://github.com/GrinRus/ai_native_sdlc_orchestrator/blob/main/NOTICE).
