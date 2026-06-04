# Supported user stories

This document groups the AOR user-story surface into role clusters. The current working set maps to **114 stories** across the lifecycle, but this document is intentionally easier to navigate than a flat list.

The flat, machine-checkable registry lives in `docs/product/user-story-coverage-matrix.md`. It assigns stable story IDs, tiers, implementation evidence, coverage status, and backlog gap references for every story in this working set.

## Coverage summary
- Total stories: **114**
- MVP: **75**
- MVP+: **24**
- Later: **15**

## Coverage by role cluster
| Role cluster | Total | MVP | MVP+ | Later |
|---|---:|---:|---:|---:|
| Product sponsor / owner | 8 | 6 | 1 | 1 |
| Discovery / research | 8 | 6 | 1 | 1 |
| Architect / tech lead | 8 | 5 | 2 | 1 |
| Engineering manager / planner | 8 | 6 | 1 | 1 |
| Delivery engineer | 10 | 7 | 2 | 1 |
| Reviewer / QA | 6 | 4 | 1 | 1 |
| AI platform owner | 12 | 6 | 4 | 2 |
| Operator / SRE | 11 | 9 | 1 | 1 |
| Security / compliance | 6 | 4 | 1 | 1 |
| Repository / multirepo owner | 6 | 4 | 1 | 1 |
| Incident / improvement owner | 6 | 3 | 2 | 1 |
| Project bootstrap / onboarding | 9 | 6 | 2 | 1 |
| Delivery transaction / Git / PR | 8 | 5 | 2 | 1 |
| Finance / audit / hygiene | 8 | 4 | 3 | 1 |

## What AOR supports today in the design

### Product sponsor / owner
- Create a project, define goals, constraints, KPIs, and Definition of Done.
- Start intake from issues, PRDs, RFCs, notes, or mail-like source material.
- Review discovery outputs, open questions, and approval gates before execution.
- Track wave status, quality gates, and delivery risk.

`W19-S02` adds the first machine-checkable intake source model: local issue, PRD, RFC, note, and mail-like source refs are preserved with goals, constraints, KPIs, Definition of Done, and completeness evidence in the intake-request body. Live SaaS connectors remain out of scope until a later integration slice exports or mirrors those sources into local structured refs.

`W21-S01` defines the installed-user journey from first launch through learning closure. Product-facing guided intake remains additive: it should populate the existing product-intake contract and surface blockers through `aor next` or guided web stages rather than replacing low-level command evidence.

`W21-S04` implements that product-facing boundary for the CLI: `aor mission create` writes the existing intake-request packet/body with goals, constraints, KPIs, Definition of Done, local source refs, allowed paths, and delivery mode, while `aor next` writes a deterministic next-action report that blocks on missing product evidence.

### Discovery / research
- Build discovery packets from repository content, project analysis, AOR-owned runtime context assets, and external research.
- Separate discovery from delivery.
- Validate discovery completeness before planning.
- Produce ADR-ready research output with evidence.
- Use explicit discovery completeness checks from command outputs before spec handoff.

`W19-S03` makes the local research path executable: `discovery run` emits a `discovery-research-report` that links repository facts, runtime context assets, local intake source refs, open questions, and ADR-ready recommendations. `spec build` carries the same research gate into the routed step result so handoff can inspect ADR-readiness without rerunning discovery.

### Architect / tech lead
- Define non-functional requirements, repo scope, risk tiers, and allowed commands.
- Inspect the chosen route, wrapper, policy, and runner for each step.
- Separate deterministic validation from rubric-based evaluation.
- Define certification and freeze paths for platform assets, runtime context assets, and compiler revisions.
- Trace planning artifacts back to architecture docs and contract references without ad hoc file inspection.

### Engineering manager / planner
- Convert approved scope into wave tickets and handoff packets.
- Split work into bounded sequential or parallel steps.
- Manage budgets, pause/resume, and execution steering.
- Track clean-close, retry, repair, and blocker rates.

### Delivery engineer
- Execute approved work through runner-agnostic routes.
- Support Codex CLI, Claude Code, OpenCode, and mock adapters.
- Run self-review, QA, retry, and repair inside the same orchestration model.
- Inspect diffs, logs, tool traces, compiled prompt/context lineage, validation reports, and delivery artifacts.

### Reviewer / QA
- Review structured review packets with risk notes and evidence.
- Inspect machine-readable review verdicts for discovery quality, artifact quality, and generated code quality before deciding whether to proceed.
- Compare deterministic validation with judge-based eval outcomes.
- Run suite-based comparisons against baselines.
- Manage flaky cases and escalation paths.

### AI platform owner
- Manage prompt bundles, context docs/rules/skills/bundles, wrappers, routes, policies, adapters, and compiler revisions as platform assets.
- Run certification before promotion.
- Compare new candidates against stable baselines.
- Freeze or demote problematic platform assets.

### Operator / SRE
- Watch live run state in CLI or web.
- Tail logs, view live events, and inspect policy plus compile decisions.
- Approve risky actions and replay failures through harness.
- Review installed-user black-box proof evidence produced by Live E2E on real repositories.
- Run full-journey live acceptance only on curated repositories and curated feature missions.
- Select the required matrix cell by scenario family, pinned provider variant, and declared feature size.
- Track which required matrix cells are still uncovered after each live E2E run.
- Read optional provider qualification by provider, adapter, coverage tier, owner, phase, evidence, and release-blocking status without opening raw provider logs.
- Ask AOR to analyze or change bounded project artifacts from any flow stage through runtime-owned request evidence.

W18 closes the connected operator-surface path for runner-requested questions: surface the question from `step-result.requested_interaction`, submit an approved operator answer through the control plane, emit query-safe live events, and keep the answer trail auditable without making the web UI own orchestration.

`W32-S01` adds operator-initiated runtime intervention: CLI, API, and web can create a durable `operator-request`, compile it into the selected runtime step, and materialize proposal/patch evidence while keeping `run steer` as run-control only.

### Security / compliance
- Enforce provider and adapter allowlists.
- Apply secret-safe logging and redaction.
- Preserve audit trails for approvals, overrides, and route changes.
- Use stricter gates for higher-risk flows.

### Repository / multirepo owner
- Describe monolith or bounded multirepo topology in one project profile.
- Track repo graph, ownership, and cross-repo dependencies.
- Use scoped locks and cross-repo validation.
- Produce coordinated delivery manifests for bounded multirepo work.

Bounded multirepo means one AOR project profile can coordinate several explicit repositories, such as backend services, mobile, and frontend repos. It does not mean MVP portfolio orchestration across multiple independent AOR `project_id` profiles. W36 adds a local app workspace that can switch between explicitly added projects, but each project still owns separate runtime state, flows, and evidence.

### Incident / improvement owner
- Open incident reports from failed releases or production feedback.
- Backfill incidents into datasets and suites through reviewed proposal artifacts.
- See which routes, prompt/context assets, wrappers, adapters, or compiler revisions correlate with incidents.
- Force recertification before re-enabling a problematic route.

### Project bootstrap / onboarding
- Run `project analyze`, `project validate`, and `project verify`.
- Materialize project-analysis reports with commands, service boundaries, risk zones, and runtime-context readiness.
- Recommend missing AOR-native runtime context assets and project-profile coverage.
- Block execution if prerequisites are missing.

`W21-S01` makes onboarding a first-class installed-user journey rather than a list of independent bootstrap commands. Later W21 slices implement the guided CLI shortcuts, asset-mode onboarding report, next-action resolver, guided web stages, closure UX, and proof rehearsal.

`W21-S04` closes the guided mission and next-action resolver portion: installed users get one primary next command, evidence refs, blockers, active-run handling, and explicit write-back policy before delivery-capable work is recommended.

`W31-S01` closes the installed-user local UI intake story, and `W36-S03`/`W36-S04` make it no-settings and project-aware: a user who installed `@grinrus/aor` can run `cd <repo> && aor app`, confirm project context, initialize the runtime explicitly, apply the safe walkthrough Mission template, submit the first mission, switch between explicitly added local projects, and see the refreshed next action, blockers, evidence refs, and `.aor/` runtime root without reading internal implementation docs.

### Delivery transaction / Git / PR flow
- Deliver output through canonical `patch-only`, `local-branch`, or `fork-first-pr` policy modes.
- Produce a delivery manifest that links execution to actual write-back artifacts.
- Isolate parallel runs with worktree and branch semantics.
- Rerun from a packet boundary or a failed step.

### Finance / audit / hygiene
- Track cost and latency by route, prompt/context bundle, compiler revision, adapter, and project.
- Preserve durable evidence for reviews and audits.
- Distinguish production monitoring from offline certification.
- Keep platform hygiene visible through promotion, freeze, and regression signals.

## MVP meaning
MVP for AOR means the system can prove a full bounded flow on a real repository:
1. bootstrap a project,
2. materialize packets,
3. execute bounded work,
4. validate and evaluate quality,
5. prepare delivery output,
6. learn from failures through incidents and datasets.

The W13 live-acceptance bar raises that proof for curated rehearsal targets:
1. bootstrap a clean target repo through public CLI,
2. prepare a feature-specific intake request,
3. generate discovery/spec/handoff during the run,
4. execute through public run-control surfaces,
5. emit review and learning-loop closure artifacts,
6. judge the result on runtime, discovery, artifact, code, delivery, and learning quality.
