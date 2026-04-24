# Project description

## One-line definition
AOR is an AI-native control plane that orchestrates the full SDLC from discovery to delivery across multiple runners, with evaluation and harness built in by default.

## What makes AOR different
AOR is not trying to replace every coding agent. It is the coordination layer around them.

The product owns:
- project bootstrap and machine-usable context;
- packet lifecycle and approval boundaries;
- route, wrapper, prompt, context, and policy resolution;
- execution, review, QA, delivery, and release orchestration;
- validation, eval, harness, and certification;
- incident learning and promotion decisions.

The runners own:
- local reasoning and code manipulation inside a bounded step;
- tool calls supported by the adapter;
- session-local execution inside the constraints AOR provides.

## Core product goals
1. Support the full SDLC, not just implementation.
2. Work with multiple runners and adapters.
3. Keep the core orchestration model runner-agnostic.
4. Default to evidence, replay, and certification.
5. Work for monoliths and bounded multirepo projects.
6. Stay usable without a web UI.
7. Rehearse end-to-end flows on curated public repositories with mission-specific discovery.

## Core product objects
- **Project profile** — persistent configuration of repos, routes, policies, budgets, and write-back rules.
- **Project analysis report** — materialized bootstrap knowledge about the target repository.
- **Runtime context assets** — versioned docs, rules, skills, and bundles used to assemble step-specific context.
- **Packets** — durable artifacts that carry intent and decisions across the lifecycle.
- **Compiled context artifact** — the resolved prompt/context payload and provenance for one routed step.
- **Step results** — normalized outputs of execution and non-execution steps.
- **Quality evidence** — validation reports, evaluation reports, harness traces, logs, diffs, and screenshots.
- **Delivery manifest** — the durable link between execution and actual delivery output.
- **Promotion decisions** — the record of whether a platform asset can move from candidate to stable or frozen.
- **Incident reports** — the bridge from production failure back into learning memory.

## Full lifecycle AOR must close
1. **Bootstrap** — initialize the project, analyze it, validate the profile, and verify the target.
2. **Intake and discovery** — ingest a request and turn it into discovery and research packets.
3. **Specification and planning** — build a spec, wave ticket, and approved handoff packet.
4. **Execution** — run bounded implementation, review, QA, retry, and repair steps from an approved mission-linked handoff.
5. **Delivery** — prepare patches, branches, or PRs according to policy.
6. **Release** — materialize release packets and sign-off evidence.
7. **Learning** — backfill incidents into datasets, suites, and certification decisions.

## Built-in quality model
AOR uses a layered quality model.

### Layer 1 — deterministic validation
Schema checks, command execution, repo-scope enforcement, evidence completeness, and other objective rules.

### Layer 2 — evaluation
Task-specific suites that score runs, wrappers, routes, or adapters.

### Layer 3 — harness
Replay, certification, compare-to-baseline, and failure-mode workflows.

### Layer 4 — promotion
Candidate assets become stable only after passing the right certification evidence.

## Supported runner model
AOR must work with:
- Codex CLI
- Claude Code
- OpenCode
- mock adapters for development and certification
- future internal adapters

Runner integration is handled through adapters and capability profiles, not by hard-coding provider behavior into core workflows.

## Prompt and runtime-context evolution
AOR treats prompt bundles, runtime context assets, wrappers, routes, policies, adapters, and compiler revisions as platform assets.

That means:
- they can change independently;
- they can be evaluated independently;
- they can be promoted or frozen independently;
- they can be traced back to incidents and regressions.

Repository contributor guidance such as `AGENTS.md` and `.agents/**` stays outside that runtime asset graph. Those files are for developing AOR itself, not for runtime context injection.

## Monolith and multirepo support
AOR must work for:
- a single repository;
- a monorepo with multiple apps/packages/services;
- a bounded multirepo graph where impacted repos are explicit and delivery is coordinated.

AOR does **not** target unbounded organization-wide orchestration in MVP.

## Live E2E posture
AOR ships with four standard rehearsal classes:
- regress short
- regress long
- release short
- release long

These profiles are designed to run on real public repositories through read-only, patch, or fork-first delivery defaults.

The W13 full-journey layer adds:
- curated repository selection instead of arbitrary live targets;
- curated feature missions per repository;
- feature-intent intake generated during the run;
- discovery, spec, handoff, execution, review, delivery, and learning closure through public CLI surfaces;
- explicit verdicts for discovery quality, artifact quality, generated code quality, delivery/release quality, and learning-loop closure.

## Non-goals for MVP
- autonomous organization-wide portfolio optimization;
- fully automatic self-improving prompts without certification and human approval;
- hidden provider-specific magic inside the orchestrator core;
- UI-owned orchestration logic.

## Success criteria for the first implementation
AOR v1 is successful when the repo can demonstrate that:
- project bootstrap is repeatable;
- the packet chain is durable and inspectable;
- a routed runner can execute bounded work;
- validation, eval, and harness are part of the default flow;
- delivery output is materialized as a manifest;
- platform and runtime-context asset changes can be certified on real repositories.
