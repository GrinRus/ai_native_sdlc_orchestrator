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
- Build discovery packets from repository content, docs, AGENTS guidance, and external research.
- Separate discovery from delivery.
- Validate discovery completeness before planning.
- Produce ADR-ready research output with evidence.

### Architect / tech lead
- Define non-functional requirements, repo scope, risk tiers, and allowed commands.
- Inspect the chosen route, wrapper, policy, and runner for each step.
- Separate deterministic validation from rubric-based evaluation.
- Define certification and freeze paths for platform assets.

### Engineering manager / planner
- Convert approved scope into wave tickets and handoff packets.
- Split work into bounded sequential or parallel steps.
- Manage budgets, pause/resume, and execution steering.
- Track clean-close, retry, repair, and blocker rates.

### Delivery engineer
- Execute approved work through runner-agnostic routes.
- Support Codex CLI, Claude Code, OpenCode, and mock adapters.
- Run self-review, QA, retry, and repair inside the same orchestration model.
- Inspect diffs, logs, tool traces, validation reports, and delivery artifacts.

### Reviewer / QA
- Review structured review packets with risk notes and evidence.
- Compare deterministic validation with judge-based eval outcomes.
- Run suite-based comparisons against baselines.
- Manage flaky cases and escalation paths.

### AI platform owner
- Manage prompt bundles, wrappers, routes, policies, and adapters as platform assets.
- Run certification before promotion.
- Compare new candidates against stable baselines.
- Freeze or demote problematic platform assets.

### Operator / SRE
- Watch live run state in CLI or web.
- Tail logs, view live events, and inspect policy decisions.
- Approve risky actions and replay failures through harness.
- Run standard live E2E profiles on real repositories.

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
- See which routes, wrappers, or adapters correlate with incidents.
- Force recertification before re-enabling a problematic route.

### Project bootstrap / onboarding
- Run `project analyze`, `project validate`, and `project verify`.
- Materialize project-analysis reports with commands, service boundaries, and risk zones.
- Generate repository guidance recommendations such as local AGENTS files and skills.
- Block execution if prerequisites are missing.

### Delivery transaction / Git / PR flow
- Deliver output as a patch, branch, or pull request according to policy.
- Produce a delivery manifest that links execution to actual write-back artifacts.
- Isolate parallel runs with worktree and branch semantics.
- Rerun from a packet boundary or a failed step.

### Finance / audit / hygiene
- Track cost and latency by route, wrapper, adapter, and project.
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
