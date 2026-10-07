# Project description and positioning

## One-line definition

AOR is a local-first control plane for turning software requests into verified
outcomes through bounded AI work and explicit human decisions.

## Product promise and status

The operator states the desired result, reviews the work boundaries, resolves
material decisions, and checks the result against observable criteria. AOR
coordinates the runners, preserves the approved intent, and retains evidence
through preparation, execution, review, delivery, release, and learning.

This is the product direction registered in [W72](../backlog/wave-72-implementation-slices.md).
The [accepted Task architecture](../architecture/17-iterative-task-architecture.md)
records all 19 design decisions and their implementation owners. W72 replaces
the current runtime model before release, without legacy readers, dual engines,
opt-in rollout, or conversion of old Tasks. Revision history and recovery
within the new model remain required.
The current alpha provides the Task Workspace, bounded execution, durable
approvals, reports, and delivery evidence. W72's effective answer reconciliation,
adopted decision records, criterion-level verification, adaptive preparation,
and revised UI remain planned. Positioning does not certify those capabilities
or change the production audit hold.

## Audience and primary jobs

| User | Job | Value to demonstrate |
| --- | --- | --- |
| Repository maintainer or delivery engineer | Complete a bounded change or investigation and understand its limits. | A clear outcome, permitted work, meaningful recovery, and inspectable proof. |
| Technical lead or product owner | Resolve consequential product choices while delegating implementation. | Original intent, changed behavior, assumptions, and consequences together at the decision boundary. |
| Reviewer, QA, or operator | Decide whether a result is ready and what remains uncertain. | Current criterion evidence, source changes, delivery effects, and durable decision history. |

The first adoption path is a local repository or bounded multirepo project
with an existing coding runner. CLI/API users and installed web users share
the same Task authority and outcome. Organization-wide portfolio management
remains outside the product's MVP boundary.

## Positioning principles

1. **The result is the primary promise.** Product copy and navigation explain
   what the Task will accomplish, what the operator must decide, and what has
   been verified.
2. **Human attention has an explicit purpose.** Start reviews work bounds;
   decisions review consequences; Review inspects behavior and criterion proof.
   Important unresolved assumptions remain visible at these boundaries.
3. **Preparation follows the problem.** W72 selects discovery, research,
   specification, and planning depth by uncertainty and consequences. Required
   artifacts and safety gates remain explicit for the selected strategy.
4. **Understanding and correctness require evidence.** A generated summary,
   an approval click, or a successful command cannot by itself establish either.
   Human comprehension is a hypothesis evaluated in the W72 pilot.
5. **Technical depth remains available.** Packets, specifications, plans,
   patches, logs, and provenance can be inspected from the related Task,
   decision, or criterion. Detailed review remains required where policy or
   consequence demands it.

Use this document for positioning and scope, and the
[iterative Task UX direction](10-iterative-task-ux.md) for the target journey,
screen hierarchy, states, interaction rules, and design validation. W70/W71
visual and runtime acceptance retain their historical scope.

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
1. Turn a software request into a verified, bounded outcome.
2. Work with multiple runners and adapters.
3. Keep the core orchestration model runner-agnostic.
4. Default to evidence, replay, and certification.
5. Work for monoliths and bounded multirepo projects.
6. Stay usable without a web UI.
7. Rehearse end-to-end flows on curated public repositories with mission-specific discovery.
8. Support the full SDLC through the preparation and quality strategy appropriate to each Task.

## Core product objects
- **Task** — the target domain owner of requested outcome, lifecycle, decisions, budget, execution units, and review. Runs/attempts remain execution identities; Flow cannot own a competing Task lifecycle. The installed pre-W72 projection remains the current baseline until replacement.
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

W72 proposes minimal decision-record and criterion-verification-report
contracts. The approved intake-request body remains the effective requirements
owner; projections and plans bind its version. These proposed contracts do not
yet extend the implemented contract registry.

## Lifecycle capabilities and preparation depth

| Capability | Operator outcome |
| --- | --- |
| Bootstrap | Connect and verify the project's context and permitted repositories. |
| Intake, discovery, and research | Preserve the request, establish facts, and expose meaningful unknowns. |
| Specification and planning | Describe expected behavior and an executable approach at the required depth. |
| Execution, review, and QA | Perform bounded work, observe results, repair within limits, and verify behavior. |
| Delivery | Produce policy-approved patches, branches, or PR-ready output with evidence. |
| Release | Bind release decisions to the exact source, package, and qualification evidence. |
| Learning | Propose incident backfill and certify platform asset changes. |

These are lifecycle capabilities. The W72 target journey selects their depth
and iteration boundaries for the Task. A simple bugfix may use a short strategy;
an ambiguous architectural change may require research, a specification, and
several decisions. Analysis and review Tasks retain their no-write semantics.

The current runtime's discovery/specification/planning prerequisites remain
in force until W72 updates their contracts and consumers. This positioning
document does not introduce a UI bypass for an existing required artifact.

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

Qwen Code is an extended candidate adapter; restricted-mode and full live
qualification remain pending and are not baseline support claims.

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

The Local Workspace is operator-local state, not a target repository. Portable
AOR Project profiles describe repositories and components, while Project
Bindings contain machine-local checkout paths and redacted readiness. A
Workspace Set is a later run-scoped snapshot of those bindings rather than a
second project definition.

AOR does **not** target unbounded organization-wide orchestration in MVP.

The MVP proof path for bounded multirepo support is intentionally narrow: one profile, explicit `repos[]`, explicit `repo_graph[]`, deterministic per-repo and integration validation refs, coordination evidence before non-`no-write` delivery, and repo-level changed-path lineage in the delivery manifest and release packet.

W60-W62 plan the post-audit maturity boundary. W60 makes planning tasks structured,
versioned, acceptance-traceable, and evidence-derived. W61 separates portable
project/repository/component topology from machine-local repository bindings and
adds explicit installed-user management. W62 provisions run-scoped workspace
sets and coordinates task DAG execution, integration, repair, and per-repository
delivery under one parent mission. These waves do not add portfolio
orchestration across independent AOR project IDs.

The operator experience for this boundary is defined in
`docs/product/04-project-topology-and-task-planning-ux.md`.

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
