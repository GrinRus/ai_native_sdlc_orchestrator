# AOR - AI-native Orchestrator for Full SDLC

AOR is an AI-native SDLC control plane and orchestrator. It coordinates
bounded work packets, contracts, runners, evidence, reviews, and delivery
decisions across the software lifecycle.

AOR is not a coding agent, hosted SaaS, or package you install from npm today.

## Status: source-only alpha

AOR is a public source checkout for early operators, contributors, and
researchers. The repository is docs-first and includes implemented CLI, API,
web, and runtime baselines, but it is not a production-ready general-purpose
orchestrator runtime.

The current production-candidate claim is intentionally bounded: AOR has a
self-hosted CLI/API production candidate for the documented mode in
`docs/ops/self-hosted-release.md`. Repository checks such as `pnpm check` and
`pnpm production:ready` prove source integrity and documented readiness gates;
they do not mean unattended production automation is safe for arbitrary
projects.

Packages remain `private: true` and `version: 0.0.0`. Public distribution is
source-only until npm or GitHub Releases are explicitly added in a separate
release decision.

## Current source channel

The public source-only main channel is the `main` branch on GitHub. There is no
npm, GitHub Releases, Docker, or GHCR version channel yet.

The package state is intentionally `private:true / 0.0.0`: use the repository
source checkout as the versioned artifact until a separate distribution policy
changes that.

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

## Clone and install from source

```bash
git clone https://github.com/GrinRus/ai_native_sdlc_orchestrator.git
cd ai_native_sdlc_orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm aor --help
```

This installs the source checkout and exposes the local CLI through the root
`pnpm aor` script. It does not publish or install npm packages.

## Run your first no-write local mission

Run AOR against a local target repository. The safest first path uses
`delivery-mode no-write` and stores runtime state under the target repository.
It intentionally lets AOR generate a bundled project profile under `.aor/`
instead of copying example assets into the target repository. This path does not
require authenticated external runners.

In no-write mode, AOR still writes runtime state: it can create reports,
packets, and the generated bundled profile under `$TARGET_REPO/.aor`, but it
must not edit target source files or attempt upstream write-back.

```bash
export TARGET_REPO=/path/to/local-project
export AOR_RUNTIME="$TARGET_REPO/.aor"

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
- `mission create` writes an intake artifact packet and request body.
- `next` writes a next-action report and returns the relevant artifact paths in
  JSON output.
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

AOR is headless-first. The CLI is the primary public operator path today.

The repository also contains API and web baselines for the control-plane model:

- `apps/api` hosts the API surface used by the documented self-hosted mode.
- `apps/web` is optional and detachable from core orchestration.
- `pnpm aor app --help` describes local app attachment commands.
- API contracts are documented under `docs/contracts/control-plane-api.md`.

Use these surfaces as implemented baselines, not as a hosted product claim.

## What works today

| Capability | Status | How to try or verify |
| --- | --- | --- |
| Source checkout install | Implemented | `corepack enable` and `pnpm install --frozen-lockfile`. |
| Repository integrity checks | Implemented | `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`. |
| Guided target onboarding | Implemented baseline | `pnpm aor onboard ... --json`. |
| No-write mission intake | Implemented baseline | `pnpm aor mission create ... --delivery-mode no-write --json`. |
| Next-action reporting | Implemented baseline | `pnpm aor next ... --json`. |
| CLI/API/web baselines | Implemented baseline | See `apps/*`, `packages/*`, and the command catalog. |
| Internal live E2E proof fixtures | Implemented for curated rehearsals | See `docs/ops/live-e2e-runbook.md` and `examples/live-e2e/`. |
| Production-readiness gate | Implemented bounded gate | `pnpm production:ready --json`. |

Readiness evidence is tracked in backlog and ops documents rather than release
notes. The current implemented span includes W10-W26 source, runtime,
evaluation, delivery, self-hosted, CI, and community hardening slices. Start
with `docs/backlog/mvp-roadmap.md`, `docs/backlog/backlog-operating-model.md`,
`docs/ops/live-e2e-runbook.md`, and `docs/ops/self-hosted-release.md`.

## When not to use AOR yet

Do not use AOR yet if you need:

- npm-installable public packages.
- GitHub Releases, Docker images, or GHCR distribution.
- Hosted SaaS, managed accounts, or enterprise identity/SSO.
- Broad runner/provider parity across arbitrary tools.
- Default upstream write-back automation.
- Unattended production automation for critical repositories.

These are valid future directions, but they are outside the current
source-only alpha contract.

## Docs map

Start here when you need deeper context:

- `docs/architecture/12-orchestrator-operating-model.md` - end-to-end runtime
  model and boundaries.
- `docs/contracts/00-index.md` - contract index for packets, reports, profiles,
  wrappers, and scorecards.
- `docs/architecture/14-cli-command-catalog.md` - implemented and planned CLI
  command surface.
- `docs/backlog/backlog-operating-model.md` - planning and delivery workflow.
- `docs/backlog/mvp-roadmap.md` - roadmap and readiness story.
- `docs/ops/live-e2e-runbook.md` - live E2E proof runbook.
- `docs/ops/self-hosted-release.md` - bounded self-hosted release operating
  model.

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
  web/                 Optional web surface baseline.
packages/
  orchestrator-core/   Shared runtime, contracts, adapters, and command logic.
docs/
  architecture/        Operating model and architecture decisions.
  contracts/           Contract source of truth and schemas.
  backlog/             Roadmap, waves, epics, and slices.
  ops/                 Runbooks and release-readiness material.
examples/
  live-e2e/            Curated live E2E fixtures and profiles.
scripts/
  *.mjs                Repository-integrity checks.
```

## Live E2E target projects

Live E2E fixtures are curated proof paths, not default user onboarding. They are
documented under `examples/live-e2e/` with runbook guidance in
`docs/ops/live-e2e-runbook.md`.

Public-repo safety rules apply:

- Live E2E must default to no upstream writes unless a profile explicitly opts
  into a guarded delivery mode.
- Generated target checkouts and `.aor/` runtime roots must not be committed.
- Secrets, tokens, and runner credentials must stay outside repository files.

## Roadmap

The roadmap lives in `docs/backlog/mvp-roadmap.md`; wave and slice details live
under `docs/backlog/`. Treat those files as the planning source of truth.

The current source-only alpha focuses on:

- Safer operator onboarding.
- Stronger runner-adapter coverage.
- Clearer review, QA, and delivery evidence.
- Public-repo security posture and governance.
- Bounded self-hosted CLI/API operation.

## Contributing

See `CONTRIBUTING.md` for the contributor workflow, local gates, PR checklist,
and security reminders. Pull requests should preserve the source-only alpha
contract unless they intentionally update the release policy.

## Security and responsible disclosure

See `SECURITY.md` for the supported pre-release branch, private vulnerability
reporting path, and AOR-specific risks around runner orchestration, `.aor/`
runtime state, secrets, live E2E, and upstream write-back.

Do not publish secrets, credentials, exploit details, generated target
checkouts, or sensitive runtime artifacts in public issues or pull requests.

## Support and roadmap

See `SUPPORT.md` for the alpha support policy. Use GitHub issues for bugs,
feature requests, and documentation gaps. There is no support SLA for this
pre-release project.

## License

Apache License 2.0. See `LICENSE`.
