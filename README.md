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

The root package is publishable as `@grinrus/aor@0.1.0-alpha.13`; internal
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
npm install -g @grinrus/aor@0.1.0-alpha.13
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

Run AOR from the local target repository and let the UI guide setup:

```bash
cd /path/to/local-project
aor app
```

`aor app` starts a foreground local loopback server on `127.0.0.1`, opens the
browser by default, and prints the URL. Press `Ctrl+C` in that terminal to stop
the server. On a clean project the UI shows a first-run wizard:

1. confirm the project path and runtime root;
2. explicitly run **Initialize Project Runtime**;
3. create the first no-write flow from the safe Mission template;
4. refresh the next action and land in the active flow cockpit.

The local console is flow-centric and project-aware: the top bar shows the
active project switcher, runtime status, flow selector, and `New Flow`. Use
**Add local project** to add another repository explicitly; the app does not
scan the filesystem and keeps runtime/evidence/flow state isolated per project.

This path keeps `delivery-mode no-write` by default and stores runtime state
under the target repository. It intentionally lets AOR generate a bundled
project profile under `.aor/` instead of copying example assets into the target
repository. It does not require authenticated external runners.

In no-write mode, AOR still writes runtime state: it can create reports,
packets, and the generated bundled profile under `$TARGET_REPO/.aor`, but it
must not edit target source files or attempt upstream write-back.

Advanced/headless users can still run the same setup through CLI commands:

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

In the Mission form, the bundled safe walkthrough template fills only existing
intake fields: title, brief, goal, constraint, KPI, Definition of Done, and
`delivery-mode=no-write`. Riskier delivery modes stay visible but require an
explicit user selection and the existing policy gates.

From any selected flow stage, use **Ask AOR** to create a durable operator
request. This is not a direct chat with a runner: the request is stored as an
`operator-request` artifact, validated against target refs, allowed paths, and
delivery mode, compiled into the selected runtime step context with
`target_flow_id`, and run through the same routed runtime path as CLI/API
execution. The default is still `delivery-mode=no-write`, which produces
analysis/proposal evidence only. `patch-only` creates patch evidence inside
explicit `allowed_paths` without silently mutating project files.

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

The same operator-request flow is available headlessly:

```bash
aor request create \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --stage spec \
  --intent analyze \
  --request "Explain the README and identify safe first changes" \
  --target-ref README.md \
  --delivery-mode no-write \
  --json

aor request run \
  --project-ref "$TARGET_REPO" \
  --runtime-root "$AOR_RUNTIME" \
  --request-ref "packet://operator-request@evidence://..." \
  --target-step spec \
  --json
```

For release or CI smoke, use the packaged app route without opening a browser:

```bash
aor app --project-ref "$TARGET_REPO" --runtime-root "$AOR_RUNTIME" --smoke --open false --json
```

The smoke JSON must report `status=smoke-pass`, `html_loaded=true`,
`first_run_wizard_loaded=true`, `project_switcher_loaded=true`,
`flow_selector_loaded=true`, `new_flow_action_loaded=true`, matching
`config_project_id` / `state_project_id` values, and matching
`config_default_project_id` / `project_index_default_project_id` values. This
deterministic app smoke is a release guardrail, not a hosted-service or
production-automation claim. On a clean target, app smoke should pass without
creating `.aor/`; runtime initialization remains an explicit UI action or
headless `aor onboard` command.

To prove the published npm package rather than the local source checkout, run
registry smoke from a neutral temporary runner directory:

```bash
TMP="$(mktemp -d)"
mkdir -p "$TMP/target" "$TMP/runner"
git -C "$TMP/target" init
cd "$TMP/runner"

npm exec --yes --package @grinrus/aor@0.1.0-alpha.13 -- aor --help

npm exec --yes --package @grinrus/aor@0.1.0-alpha.13 -- \
  aor app --project-ref "$TMP/target" --runtime-root "$TMP/target/.aor" --smoke --open false --json
```

Do not run this registry-package smoke from the AOR source checkout. npm can
prefer the local package context when the current directory is itself
`@grinrus/aor`, which can hide the registry package's `aor` bin from the smoke
PATH and produce a false `aor: command not found` result.

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
- the local UI shows first-run onboarding, the project switcher, flow selector,
  active/completed flow boundaries, flow-scoped stage rail, and `New Flow`
  draft intake while keeping the flow as the primary operator object.
- `Ask AOR` and `aor request create/run/status` write durable operator-request
  evidence, proposal refs, optional patch refs, compiled-context refs, and a
  refreshed next-action report scoped to the selected flow.
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

- `aor app` launches the optional local web console for a target project. It is
  the product operator-console path in the local alpha and supports explicitly
  added local projects in one loopback UI.
- `apps/web` contains the React/Vite operator console source and packaged
  `dist` assets.
- `apps/api` remains a thin API export surface; shared HTTP/SSE transport lives
  in `packages/orchestrator-core`.
- `pnpm aor app --help` describes the local app launcher and smoke flags.
- API contracts are documented under `docs/contracts/control-plane-api.md`.
- There is no supported generated static HTML console; release and CI smoke use
  the real `aor app --smoke --open false --json` path.

Use these surfaces as implemented local baselines, not as a hosted product
claim.

## What works today

| Capability | Status | How to try or verify |
| --- | --- | --- |
| npm CLI alpha package | Implemented alpha | `npm install -g @grinrus/aor@0.1.0-alpha.13`. |
| Source checkout install | Implemented | `corepack enable` and `pnpm install --frozen-lockfile`. |
| Repository integrity checks | Implemented | `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`. |
| Guided target onboarding | Implemented UI baseline | `cd <repo> && aor app`; headless path remains `pnpm aor onboard ... --json`. |
| No-write mission intake | Implemented baseline | `pnpm aor mission create ... --delivery-mode no-write --json`. |
| Next-action reporting | Implemented baseline | `pnpm aor next ... --json`. |
| Local installed-user UI | Implemented flow-centric baseline | `aor app` launches the packaged SPA with first-run wizard, project switcher, flow selector, active/completed flow views, and `New Flow`. |
| Operator requests | Implemented flow-scoped baseline | `aor request create/run/status` routes bounded Ask AOR work through runtime evidence and `target_flow_id`. |
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

The current roadmap source of truth extends through W55 in
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

The CLI command surface currently includes **47 implemented** commands and **0 planned** commands. The command catalog lives in `docs/architecture/14-cli-command-catalog.md`.

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

The current alpha distribution is tracked through `W55` and focuses on:

- Safer operator onboarding.
- No-settings local UI onboarding and explicit local multi-project workspaces.
- Stronger runner-adapter coverage.
- Provider-neutral internal rehearsal lifecycle semantics across supported
  provider variants.
- Clearer review, QA, and delivery evidence.
- Strict internal product-acceptance closure for W46 classified findings.
- Internal failure-closure work for W49 Fastify/Vitest blockers without
  weakening product-quality gates.
- Clean-commit product proof closure, Vitest large acceptance, final quality
  report hydration, and explicit target-readiness follow-up after W50.
- Remaining maintainer hard-target closure for Vitest and SQLAlchemy, with
  strict product acceptance limited to terminal run-health pass plus final
  all-pass quality gates.
- Generic project verification command groups for setup, build, lint, test,
  typecheck, e2e, and full-suite checks without leaking internal proof harness
  semantics into AOR core artifacts.
- Actionable repair evidence, hard-target profile alignment, and provider
  guardrail follow-up from the latest `ky` large/xlarge control findings.
- Verification-plan authoring, stack discovery, profile generation, and
  operator-visible command-group status for arbitrary project shapes.
- Maintainer-facing product-quality cycles with QA-origin public repair and
  hard-target toolchain policy.
- Repair anti-loop evidence and QA-specific product-quality gates before
  maintainer acceptance claims.
- Public-repo security posture and governance.
- Bounded self-hosted CLI/API operation.
- Reproducible npm CLI alpha distribution.
- W30 alpha hardening through ADRs, OpenAPI route drift checks, self-hosted
  operations runbooks, and release smoke evidence.
- Installed-user local app launch with a guided Mission intake UI.
- Discovery/research/spec prompt granularity, artifact-readiness transitions,
  operator-visible prompt/context lineage, and maintainer validation evidence.
- Bounded review/QA repair-loop planning with shared repair requests,
  prompt/context lineage, explicit attempt budgets, operator-visible next
  actions, documentation refresh, and required maintainer acceptance evidence.
- Runtime-owned operator requests for bounded analysis, document proposals,
  patch evidence, and next-action refresh from CLI, API, or web.
- Console source-of-truth alignment around `aor app` and app-smoke proof,
  without a generated static HTML console.
- Flow-centric console refactor implementation for runtime-owned
  active/completed flows, explicit `New Flow` behavior, closure-to-follow-up
  flow creation, and browser-task guided proof evidence.
- Internal operator-proof hardening for long-running provider heartbeat,
  decision helper automation, readable artifact refs, execution evidence,
  interruption controls, and Codex/Qwen qualification.
- Internal rehearsal target setup closure so Codex/Qwen qualification retries
  do not block on unbounded Playwright or target verification setup before
  operator-visible decisions.
- Qwen stream progress mapping so realtime `stream-json` activity appears as
  provider heartbeat/progress evidence instead of misleading silent-running UX.
- Post-alpha.7 installed-user hardening for clean registry smoke commands,
  no-settings onboarding polish, internal rehearsal heartbeat visibility, and
  optional provider qualification planning.
- Post-alpha.8 installed-user validation, provider qualification evidence
  refresh, and owner/phase-classified findings closure before deciding whether a
  follow-up fix or release is needed.
- Alpha.10 release publication for operator-owned provider interruption
  classification, followed by installed-user and maintainer-side rehearsal
  confidence refresh before any next release decision.

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
