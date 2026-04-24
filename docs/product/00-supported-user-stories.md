# Supported user stories

This document groups the AOR user-story surface into role clusters. The current working set still maps to **112 stories** across the lifecycle, but this document is intentionally easier to navigate than a flat list.

## Coverage summary
- Total stories: **112**
- MVP: **73**
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
| Operator / SRE | 10 | 8 | 1 | 1 |
| Security / compliance | 6 | 4 | 1 | 1 |
| Repository / multirepo owner | 6 | 4 | 1 | 1 |
| Incident / improvement owner | 6 | 3 | 2 | 1 |
| Project bootstrap / onboarding | 8 | 5 | 2 | 1 |
| Delivery transaction / Git / PR | 8 | 5 | 2 | 1 |
| Finance / audit / hygiene | 8 | 4 | 3 | 1 |

## What AOR supports today in the design

### Product sponsor / owner
- Create a project, define goals, constraints, KPIs, and Definition of Done.
- Start intake from issues, PRDs, RFCs, notes, or mail-like source material.
- Review discovery outputs, open questions, and approval gates before execution.
- Track wave status, quality gates, and delivery risk.

### Discovery / research
- Build discovery packets from repository content, project analysis, AOR-owned runtime context assets, and external research.
- Separate discovery from delivery.
- Validate discovery completeness before planning.
- Produce ADR-ready research output with evidence.
- Use explicit discovery completeness checks from command outputs before spec handoff.

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
- Review installed-user rehearsal evidence produced by the internal black-box harness on real repositories.
- Run full-journey live acceptance only on curated repositories and curated feature missions.

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

### Incident / improvement owner
- Open incident reports from failed releases or production feedback.
- Backfill incidents into datasets and suites.
- See which routes, prompt/context assets, wrappers, adapters, or compiler revisions correlate with incidents.
- Force recertification before re-enabling a problematic route.

### Project bootstrap / onboarding
- Run `project analyze`, `project validate`, and `project verify`.
- Materialize project-analysis reports with commands, service boundaries, risk zones, and runtime-context readiness.
- Recommend missing AOR-native runtime context assets and project-profile coverage.
- Block execution if prerequisites are missing.

### Delivery transaction / Git / PR flow
- Deliver output as a patch, branch, or pull request according to policy.
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
