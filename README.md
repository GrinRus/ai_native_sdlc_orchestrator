# AOR - AI-native Orchestrator for Full SDLC

AOR is an AI-native SDLC control plane and orchestrator. It coordinates
bounded work packets, contracts, runners, evidence, reviews, and delivery
decisions across the software lifecycle.

AOR is not a coding agent, hosted SaaS, or managed release platform.

## Status: alpha distribution

AOR is an alpha distribution for early operators, contributors, and
researchers. The repository remains docs-first and includes implemented CLI,
API, web, and runtime baselines, but it is not a production-ready
general-purpose orchestrator runtime.

The current production-candidate claim is intentionally bounded: AOR has a
self-hosted CLI/API production candidate for the documented mode in
`docs/ops/self-hosted-release.md`. Repository checks such as `pnpm check` and
`pnpm production:ready` prove source integrity and documented readiness gates;
they do not mean unattended production automation is safe for arbitrary
projects.

The first package channel is the npm CLI alpha package `@grinrus/aor`. Internal
workspace apps and packages remain private implementation modules and are not
public semver APIs.

## Current distribution channels

The public source channel is the `main` branch on GitHub. Versioned npm CLI
alpha releases are published as `@grinrus/aor` and tagged with matching GitHub
Releases. There is no Docker or GHCR version channel yet.

The root package is publishable as `@grinrus/aor@0.1.0-alpha.3`; internal
workspace packages stay `private:true`. The release branch and publish process
are documented in `docs/ops/npm-cli-alpha-release.md`.

## What is AOR?

AOR turns SDLC work into explicit packets and evidence:

- It reads project profiles, contracts, and runtime state before choosing the
  next bounded action.
- It routes work through runner adapters while keeping the orchestrator core
  runner-agnostic.
- It validates deterministic artifacts before any evaluation or judgment layer.
- It records reports, packets, scorecards, and manifests under a runtime root
  such as `.aor/`.
- It keeps delivery mode explicit, with no upstream writes by default for the
  first local path.

Use AOR when you want to study or operate an SDLC control plane around existing
repositories. Do not expect it to replace your coding agent, CI system, issue
tracker, or release platform yet.

## Requirements

- Node.js `>=22`
- pnpm `10.12.4`
- Corepack enabled for the pinned pnpm version
- A local target repository you are allowed to inspect

Third-party runner binaries and authentication, such as Codex CLI, Claude Code,
or OpenCode, are installed and configured outside AOR.

## Install CLI from npm alpha

```bash
npm install -g @grinrus/aor@0.1.0-alpha.3
aor --help
```

The npm alpha installs the CLI executable, bundled AOR examples/assets used by
the safe onboarding path, and the packaged local web console used by `aor app`.
It does not install third-party runner binaries or configure provider
authentication.

## Clone and install from source

```bash
git clone https://github.com/GrinRus/ai_native_sdlc_orchestrator.git
cd ai_native_sdlc_orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm aor --help
```

This installs the source checkout and exposes the local CLI through the root
`pnpm aor` script. It is still the contributor path for changing AOR itself.
When using the npm CLI package, replace `pnpm aor` in the examples below with
`aor`.

## Run your first no-write local mission

Run AOR against a local target repository. The safest first path uses the npm
CLI, initializes `.aor/` with `aor onboard .`, and then launches the local UI
with `aor app`. The UI opens the Mission form, offers a safe walkthrough
template, submits the existing `mission create` command through the control
plane, and immediately refreshes `next` so the right rail shows the current
next action, blockers, evidence refs, and runtime root.

This path keeps `delivery-mode no-write` by default and stores runtime state
under the target repository. It intentionally lets AOR generate a bundled
project profile under `.aor/` instead of copying example assets into the target
repository. It does not require authenticated external runners.

In no-write mode, AOR still writes runtime state: it can create reports,
packets, and the generated bundled profile under `$TARGET_REPO/.aor`, but it
must not edit target source files or attempt upstream write-back.

```bash
export TARGET_REPO=/path/to/local-project
export AOR_RUNTIME="$TARGET_REPO/.aor"

aor doctor --project-ref "$TARGET_REPO" --runtime-root "$AOR_RUNTIME" --json

aor onboard \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --json

aor app \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME"
```

`aor app` starts a foreground local loopback server on `127.0.0.1`, opens the
browser by default, and prints the URL. Press `Ctrl+C` in that terminal to stop
the server. If the UI starts before onboarding, the Readiness stage shows an
explicit Initialize action instead of silently creating mission evidence.

In the Mission form, the bundled safe walkthrough template fills only existing
intake fields: title, brief, goal, constraint, KPI, Definition of Done, and
`delivery-mode=no-write`. Riskier delivery modes stay visible but require an
explicit user selection and the existing policy gates.

For a headless source checkout or CI-style first run, the equivalent command
sequence remains:

```bash
pnpm aor doctor --project-ref "$TARGET_REPO" --runtime-root "$AOR_RUNTIME" --json

pnpm aor onboard \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --json

pnpm aor mission create \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --title "Small safe trial" \
  --brief "Inspect the project and recommend the next no-write step" \
  --goal "Produce bounded next-action evidence" \
  --constraint "No upstream writes, no target file edits, and no external runner execution" \
  --kpi "trial-ready:Trial readiness:ready:status" \
  --dod "No upstream writes are attempted" \
  --delivery-mode no-write \
  --json

pnpm aor next \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --json
```

For release or CI smoke, use the packaged app route without opening a browser:

```bash
aor app --project-ref "$TARGET_REPO" --runtime-root "$AOR_RUNTIME" --smoke --open false --json
```

Use a disposable local checkout or branch until you understand the generated
state. Runtime output under `.aor/` can contain project metadata, reports, and
operational evidence; keep it out of commits.

For the first run, do not pass `examples/project.aor.yaml`: that file is the AOR
repository example profile, uses the sample `project_id` `aor-core`, and is
useful for inspecting AOR's packaged examples rather than for the safest
black-box target onboarding path.

If you intentionally want to eject example routes, wrappers, prompts, policies,
adapters, and context assets into a target repository, run `aor onboard` with
`--asset-mode materialized`. That is not the default no-write quickstart because
it creates target-repo files outside `.aor/`.

## What you should see

- `doctor` reports readiness or actionable blockers for the target repository.
- `onboard` writes onboarding evidence and a generated bundled profile under
  `$AOR_RUNTIME`.
- the UI Mission form or `mission create` writes an intake artifact packet and
  request body.
- `next` writes a next-action report and returns the relevant artifact paths in
  JSON output.
- `aor app` serves the packaged SPA at `/`, app config at `/app-config.json`,
  and the same-origin control-plane API under `/api/projects/:projectId/**`.
- `delivery_mode=no-write` and `upstream_writes_default=false` remain the safe
  defaults for the first local workflow.
- `.aor/` is ignored runtime state and must not be committed.

If a command reports blockers, fix those blockers or choose a smaller local
target before moving to runner-backed execution.

## Choose a runner

| Runner path | Current fit | Notes |
| --- | --- | --- |
| `codex-cli` | Stable live baseline for supported adapter paths | Preferred baseline for the documented self-hosted mode. |
| `claude-code` | Live-runnable candidate coverage | Suitable for supported adapter experiments where the binary and auth are already configured. |
| `open-code` | Extended non-baseline coverage with delivery guardrails | Useful for matrix coverage and guarded rehearsals, not a default public baseline. |
| Custom adapters | SDK and contract path | The contracts exist, but turnkey public support depends on the adapter you provide. |

AOR describes runner orchestration contracts. It does not install third-party
runner binaries, manage their accounts, or hide their operational risk.

## Inspect artifacts

JSON command output includes report and artifact file fields when files are
written. The common runtime layout is:

- `$AOR_RUNTIME/projects/<project-id>/reports` for reports and summaries.
- `$AOR_RUNTIME/projects/<project-id>/artifacts` for packets and generated
  evidence.
- `$AOR_RUNTIME/projects/<project-id>/state` for runtime state.

Treat the whole runtime root as sensitive. It can include repository metadata,
workflow decisions, local paths, and future runner output. `.gitignore` excludes
`.aor/`; keep that policy in target repositories too.

## Optional API/web surfaces

AOR is headless-first. The CLI and control-plane runtime stay usable without
the web console.

The npm alpha also includes a packaged local SPA for installed users:

- `aor app` launches the optional local web console for a target project.
- `apps/web` contains the React/Vite operator console source and packaged
  `dist` assets.
- `apps/api` remains a thin API export surface; shared HTTP/SSE transport lives
  in `packages/orchestrator-core`.
- `pnpm aor app --help` describes the local app launcher and smoke flags.
- API contracts are documented under `docs/contracts/control-plane-api.md`.

Use these surfaces as implemented local baselines, not as a hosted product
claim.

## What works today

| Capability | Status | How to try or verify |
| --- | --- | --- |
| npm CLI alpha package | Implemented alpha | `npm install -g @grinrus/aor@0.1.0-alpha.3`. |
| Source checkout install | Implemented | `corepack enable` and `pnpm install --frozen-lockfile`. |
| Repository integrity checks | Implemented | `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`. |
| Guided target onboarding | Implemented baseline | `pnpm aor onboard ... --json`. |
| No-write mission intake | Implemented baseline | `pnpm aor mission create ... --delivery-mode no-write --json`. |
| Next-action reporting | Implemented baseline | `pnpm aor next ... --json`. |
| Local installed-user UI | Implemented baseline | `aor app --project-ref <repo>` launches the packaged SPA. |
| CLI/API/web baselines | Implemented baseline | See `apps/*`, `packages/*`, and the command catalog. |
| Production-readiness gate | Implemented bounded gate | `pnpm production:ready --json`. |

## Readiness evidence

Root checks prove repository integrity for this source checkout and npm alpha
release flow. They validate docs, examples, contracts, command surfaces, tests,
package metadata, and scaffold policy; they do not certify AOR as an unattended
production runtime for arbitrary repositories.

`pnpm production:ready --json` is a maintainer-facing gate for the bounded
self-hosted CLI/API mode documented in this repository. Internal evaluation and
proof fixtures exist for maintainers, but they are not a public onboarding path
and are intentionally not part of the README workflow.

The current roadmap source of truth extends through W31 in
`docs/backlog/mvp-roadmap.md`; this README summarizes the user-facing path
without routing operators into internal evaluation material.

## When not to use AOR yet

Do not use AOR yet if you need:

- stable GA npm packages or public SDK package APIs.
- Docker images or GHCR distribution.
- Hosted SaaS, managed accounts, or enterprise identity/SSO.
- Broad runner/provider parity across arbitrary tools.
- Default upstream write-back automation.
- Unattended production automation for critical repositories.

These are valid future directions, but they are outside the current alpha
distribution contract.

## Docs map

Start here when you need deeper context:

- `docs/architecture/12-orchestrator-operating-model.md` - end-to-end runtime
  model and boundaries.
- `docs/architecture/adr/0000-index.md` - accepted alpha-boundary
  architecture decisions and migration triggers.
- `docs/contracts/00-index.md` - contract index for packets, reports, profiles,
  wrappers, and scorecards.
- `docs/contracts/control-plane-api.openapi.json` - OpenAPI 3.1 contract for
  the implemented detached HTTP/SSE control-plane routes.
- `docs/architecture/14-cli-command-catalog.md` - implemented and planned CLI
  command surface.
- `docs/backlog/backlog-operating-model.md` - planning and delivery workflow.
- `docs/backlog/mvp-roadmap.md` - roadmap and readiness story.
- `docs/ops/self-hosted-release.md` - bounded self-hosted release operating
  model.
- `docs/ops/self-hosted-environment-matrix.md` - supported alpha operating
  modes, required credentials, and verification commands.
- `docs/ops/npm-cli-alpha-release.md` - npm CLI alpha release branch and publish
  flow.

## Contributor quickstart

Use this path when you want to change AOR itself rather than operate it against
a target repository.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm production:ready --json
```

Before opening a pull request:

- Keep docs, contracts, examples, and code aligned.
- Run `pnpm check` and `pnpm production:ready`.
- Do not commit `.aor/`, `.env`, credentials, generated target checkouts, or
  runner output.
- Update the relevant backlog, ops, or contract document when behavior changes.

## How AOR works

AOR keeps orchestration state explicit and reviewable:

1. A project profile defines repository expectations and operating defaults.
2. Commands produce packets, reports, or state transitions under the runtime
   root.
3. Contract loaders validate structured inputs before evaluation.
4. Runner adapters execute bounded work without leaking provider-specific logic
   into orchestrator core.
5. Review, QA, and delivery gates consume evidence before any write-back mode is
   allowed.

Core rules:

- Packet-first.
- Contract-first.
- Runner-agnostic core.
- Validation before evaluation.
- Harness by default.
- Headless-first runtime.
- Bounded execution.
- Public-repo safety first.

## Command surface status

The CLI command surface currently includes **44 implemented** commands and **0 planned** commands. The command catalog lives in `docs/architecture/14-cli-command-catalog.md`.

## Repository map

```text
apps/
  api/                 Control-plane API baseline.
  cli/                 CLI executable wrapper and command entrypoint.
  web/                 Optional packaged local web console.
packages/
  orchestrator-core/   Shared runtime, contracts, adapters, and command logic.
docs/
  architecture/        Operating model and architecture decisions.
  contracts/           Contract source of truth and schemas.
  backlog/             Roadmap, waves, epics, and slices.
  ops/                 Runbooks and release-readiness material.
scripts/
  *.mjs                Repository-integrity checks.
```

## Roadmap

The roadmap lives in `docs/backlog/mvp-roadmap.md`; wave and slice details live
under `docs/backlog/`. Treat those files as the planning source of truth.

The current alpha distribution is tracked through `W31` and focuses on:

- Safer operator onboarding.
- Stronger runner-adapter coverage.
- Clearer review, QA, and delivery evidence.
- Public-repo security posture and governance.
- Bounded self-hosted CLI/API operation.
- Reproducible npm CLI alpha distribution.
- W30 alpha hardening through ADRs, OpenAPI route drift checks, self-hosted
  operations runbooks, and release smoke evidence.
- Installed-user local app launch with a guided Mission intake UI.

## Contributing

See `CONTRIBUTING.md` for the contributor workflow, local gates, PR checklist,
and security reminders. Pull requests should preserve the alpha distribution
contract unless they intentionally update the release policy.

## Security and responsible disclosure

See `SECURITY.md` for the supported pre-release branch, private vulnerability
reporting path, and AOR-specific risks around runner orchestration, `.aor/`
runtime state, secrets, internal evaluation artifacts, and upstream write-back.

Do not publish secrets, credentials, exploit details, generated target
checkouts, or sensitive runtime artifacts in public issues or pull requests.

## Support and roadmap

See `SUPPORT.md` for the alpha support policy. Use GitHub issues for bugs,
feature requests, and documentation gaps. There is no support SLA for this
pre-release project.

## License

Apache License 2.0. See `LICENSE`.
