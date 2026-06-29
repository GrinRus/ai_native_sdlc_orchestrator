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

### Incident backfill proposals

Incident learning uses proposal-only artifacts before any stable dataset or suite changes. `incident-backfill-proposal` links the source incident, learning-loop handoff, scorecards, target suite/dataset refs, and impacted route/context/wrapper/adapter/compiler asset refs so reviewers can accept or reject a backfill before a separate dataset revision is authored.

Connected web surfaces may drive these lifecycle operations through the control plane, but CLI/API/runtime command handlers remain the owners of orchestration behavior and artifact materialization.

Runner-requested questions are treated as resumable operator interactions, not as a web-only exception. AOR records the question as query-safe step evidence, accepts answers only through a control-plane-owned command path, writes answer audit evidence, and then either resumes from the recorded boundary or remains blocked with explicit reasons.

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

A bounded multirepo graph belongs to one AOR project profile and may include separate repositories for backend services, mobile apps, frontend apps, documentation, or shared libraries. This is distinct from coordinating multiple independent AOR `project_id` profiles in one portfolio-level flow.

The local installed-user app may show several explicitly added local AOR
projects in one loopback session. That is a UI workspace convenience for
switching between independent `project_id` contexts; it does not merge those
projects into one planning, execution, delivery, or release flow.

AOR does **not** target unbounded organization-wide orchestration in MVP.

The MVP proof path for bounded multirepo support is intentionally narrow: one profile, explicit `repos[]`, explicit `repo_graph[]`, deterministic per-repo and integration validation refs, coordination evidence before non-`no-write` delivery, and repo-level changed-path lineage in the delivery manifest and release packet.

## Product intake source model
AOR intake preserves product acceptance evidence as a durable `intake-request-body` attached to the `intake-request` artifact packet.

The supported local source model covers:
- local issue exports;
- local PRDs;
- local RFCs;
- local notes;
- local mail-like exports.

Each intake body records product goals, constraints, KPIs, Definition of Done, source refs, and an explicit completeness status. Complete intake evidence requires all five groups to be present. Incomplete intake can still be materialized for early discovery, but downstream review and guided onboarding can inspect the missing groups instead of treating absent KPI or Definition of Done input as implicit acceptance.

Live SaaS ingestion from Jira, GitHub Issues, Gmail, Outlook, or similar systems is out of scope for the MVP intake contract. Such sources must be exported or mirrored into local structured source refs before AOR treats them as product-intake evidence.

## Discovery research and ADR readiness
Discovery produces a `discovery-research-report` alongside the project analysis report. The report links repository facts, runtime context asset refs, local intake research inputs, open questions, and ADR-ready recommendations.

The research report has two deterministic states:
- `adr-ready` when repository facts, context assets, local research source refs, goals, KPIs, Definition of Done, and ADR recommendations are present;
- `incomplete` when one or more evidence groups are missing.

`spec build` carries this research gate into its routed `step-result`. The gate does not perform autonomous web research and does not block all specification work by itself, but it makes missing ADR evidence explicit before handoff.

## Installed-User Rehearsal Posture
AOR maintainers keep four standard internal rehearsal classes:
- regress short
- regress long
- release short
- release long

These internal profiles are designed to run on real public repositories through `no-write`, `patch-only`, or `fork-first-pr` delivery defaults.

The W13 full-journey layer adds:
- curated repository selection instead of arbitrary live targets;
- curated feature missions per repository;
- feature-intent intake generated during the run;
- discovery, spec, handoff, execution, review, delivery, and learning closure through public CLI surfaces;
- explicit verdicts for discovery quality, artifact quality, generated code quality, delivery/release quality, and learning-loop closure.

## Non-goals for MVP
- autonomous organization-wide portfolio optimization;
- orchestration across multiple independent AOR `project_id` profiles in one portfolio flow;
- fully automatic self-improving prompts without certification and human approval;
- hidden provider-specific magic inside the orchestrator core;
- UI-owned orchestration logic.
- UI-local handling of runner questions without control-plane audit evidence.

## Success criteria for the first implementation
AOR v1 is successful when the repo can demonstrate that:
- project bootstrap is repeatable;
- the packet chain is durable and inspectable;
- a routed runner can execute bounded work;
- validation, eval, and harness are part of the default flow;
- delivery output is materialized as a manifest;
- platform and runtime-context asset changes can be certified on real repositories.
