# User story coverage matrix

This matrix is the machine-checkable story registry for the current 112-story AOR working set. It records current implementation evidence and points partially covered, uncovered, or blocked outcomes to backlog slices that now own the remaining gap.

Coverage status values:
- `covered` - current docs, contracts, examples, and code expose a bounded implementation path.
- `partial` - current implementation covers part of the outcome, but a backlog slice owns the missing behavior or evidence.
- `gap` - no executable implementation path exists yet beyond docs or examples.
- `blocked` - the outcome needs an external prerequisite before it can be closed honestly.

| Story ID | Role cluster | Tier | Outcome | Coverage status | Evidence | Gap slice |
|---|---|---|---|---|---|---|
| PSO-01 | Product sponsor / owner | MVP | Define project goals and constraints for a target repository. | partial | `project init`, project profiles, W13-S03 feature-intent intake | W19-S02, W21-S04 |
| PSO-02 | Product sponsor / owner | MVP | Start intake from issues, PRDs, RFCs, notes, or mail-like source material. | partial | `intake create`, W13-S03 public feature-intent intake | W19-S02, W21-S04 |
| PSO-03 | Product sponsor / owner | MVP | Review discovery outputs and open questions before execution. | partial | `discovery run`, `spec build`, W13-S04 lifecycle evidence | W19-S03, W19-S05, W21-S05 |
| PSO-04 | Product sponsor / owner | MVP | Track wave status and implementation progress. | covered | `wave create`, `run status`, W8-S01 sponsor visibility | none |
| PSO-05 | Product sponsor / owner | MVP | Inspect quality gates before approving delivery. | partial | review reports, Runtime Harness reports, W14-S06 review alignment | W19-S05, W21-S06 |
| PSO-06 | Product sponsor / owner | MVP | See delivery risk and release readiness. | covered | delivery manifests, `release prepare`, W6-S05 delivery/release command pack | none |
| PSO-07 | Product sponsor / owner | MVP+ | Track KPIs and Definition of Done as product acceptance evidence. | partial | product docs and intake command baseline | W19-S02, W21-S04 |
| PSO-08 | Product sponsor / owner | Later | Use strategic product visibility across waves and outcomes. | partial | W8-S01 sponsor and planner visibility | W19-S06, W21-S05 |
| DIS-01 | Discovery / research | MVP | Build discovery packets from repository content. | covered | `project analyze`, `discovery run`, W1-S03 project analysis | none |
| DIS-02 | Discovery / research | MVP | Include AOR-owned runtime context assets in discovery. | covered | context compiler and asset lifecycle, W8-S08, W8-S09 | none |
| DIS-03 | Discovery / research | MVP | Preserve local research inputs alongside discovery facts. | partial | discovery/spec command baseline | W19-S03 |
| DIS-04 | Discovery / research | MVP | Keep discovery separate from delivery execution. | covered | packet lifecycle, delivery policies, W4 delivery foundation | none |
| DIS-05 | Discovery / research | MVP | Validate discovery completeness before planning. | covered | `discovery run`, `spec build`, validation reports | none |
| DIS-06 | Discovery / research | MVP | Hand discovery evidence into specification. | covered | `spec build`, handoff packets, W6-S02 command pack | none |
| DIS-07 | Discovery / research | MVP+ | Produce ADR-ready research output with evidence. | partial | W8-S02 discovery and architecture maturity pack | W19-S03 |
| DIS-08 | Discovery / research | Later | Support advanced discovery research maturity. | partial | W8-S02 later discovery maturity | W19-S03 |
| ARC-01 | Architect / tech lead | MVP | Define non-functional requirements, repo scope, risk tiers, and allowed commands. | covered | project profiles, policies, W1-S05 verify flow, W2-S03 policies | none |
| ARC-02 | Architect / tech lead | MVP | Inspect route, wrapper, policy, and runner choices for each step. | covered | route registry, compiled context, `run status`, W8-S04 visibility | none |
| ARC-03 | Architect / tech lead | MVP | Separate deterministic validation from rubric-based evaluation. | covered | validation kernel, eval runner, harness, W3 quality foundation | none |
| ARC-04 | Architect / tech lead | MVP | Define certification and freeze paths for platform assets. | covered | `harness certify`, `asset promote`, `asset freeze`, W7-S02 | none |
| ARC-05 | Architect / tech lead | MVP | Trace plans back to architecture docs and contract references. | partial | backlog docs, contract index, command catalog checks | W19-S01 |
| ARC-06 | Architect / tech lead | MVP+ | Control UI attach/detach lifecycle without breaking headless operation. | covered | `ui attach`, `ui detach`, W6-S04 UI lifecycle command pack | none |
| ARC-07 | Architect / tech lead | MVP+ | Inspect governance guardrails and quality evidence parity. | covered | W7-S01 governance quality guardrails | none |
| ARC-08 | Architect / tech lead | Later | Maintain later architecture maturity and ADR traceability. | partial | W8-S02 architecture maturity pack | W19-S03 |
| EMP-01 | Engineering manager / planner | MVP | Convert approved scope into wave tickets and handoff packets. | covered | `wave create`, `handoff prepare`, W1-S07 handoff foundation | none |
| EMP-02 | Engineering manager / planner | MVP | Split work into bounded implementation steps. | partial | wave tickets, run-control command pack | W19-S06, W21-S04 |
| EMP-03 | Engineering manager / planner | MVP | Coordinate sequential or parallel execution steps. | partial | route policies, run-control command pack | W19-S06, W21-S04 |
| EMP-04 | Engineering manager / planner | MVP | Manage budgets during execution. | covered | step policies, budgets, W2-S03, W6-S03 | none |
| EMP-05 | Engineering manager / planner | MVP | Pause, resume, and cancel active runs. | covered | `run pause`, `run resume`, `run cancel`, W6-S03 | none |
| EMP-06 | Engineering manager / planner | MVP | Steer bounded execution with policy and audit traceability. | covered | `run steer`, audit records, W6-S03 | none |
| EMP-07 | Engineering manager / planner | MVP+ | Track retry, repair, clean-close, and blocker rates. | partial | run and audit artifacts | W19-S06 |
| EMP-08 | Engineering manager / planner | Later | Use strategic planner dashboards for portfolio visibility. | partial | W8-S01 sponsor and planner visibility | W19-S06 |
| DEV-01 | Delivery engineer | MVP | Execute approved work through runner-agnostic routes. | covered | route registry, adapter SDK, W2-S05, W13-S04 | none |
| DEV-02 | Delivery engineer | MVP | Run live work through the stable Codex CLI adapter baseline. | covered | W10-S01, W14 provider-pinned matrix evidence | none |
| DEV-03 | Delivery engineer | MVP | Run Claude Code as a live-runnable candidate with matrix coverage. | covered | W14 anthropic-primary matrix coverage | none |
| DEV-04 | Delivery engineer | MVP | Run OpenCode through a certified live-baseline adapter path. | blocked | extended OpenCode coverage only | W20-S03 |
| DEV-05 | Delivery engineer | MVP | Run self-review, QA, retry, and repair in one orchestration model. | partial | review reports, Runtime Harness, W13-S05 | W19-S05, W21-S06 |
| DEV-06 | Delivery engineer | MVP | Inspect diffs, logs, tool traces, and delivery artifacts. | covered | delivery manifests, run events, evidence show | none |
| DEV-07 | Delivery engineer | MVP | Inspect compiled prompt and context lineage. | covered | compiled-context artifacts, W8-S08 | none |
| DEV-08 | Delivery engineer | MVP+ | Use operator UI lifecycle commands during delivery support. | covered | `ui attach`, `ui detach`, W6-S04 | none |
| DEV-09 | Delivery engineer | MVP+ | Execute with policy and audit guardrails. | covered | W6-S03 run-control guardrails, W10-S04 auth hardening | none |
| DEV-10 | Delivery engineer | Later | Use later delivery and security governance maturity. | partial | W8-S03 route-governance maturity | W20-S02 |
| RQA-01 | Reviewer / QA | MVP | Review structured review packets with risk notes and evidence. | covered | `review run`, review reports, W13-S05 | none |
| RQA-02 | Reviewer / QA | MVP | Inspect machine-readable review verdicts before proceeding. | partial | review reports and Runtime Harness verdicts | W19-S05, W21-S06 |
| RQA-03 | Reviewer / QA | MVP | Compare deterministic validation with judge-based eval outcomes. | covered | validation reports, eval runner, W3, W7-S01 | none |
| RQA-04 | Reviewer / QA | MVP | Run suite-based comparisons against baselines. | covered | eval suites, harness capture/replay, W3-S03, W8-S05 | none |
| RQA-05 | Reviewer / QA | MVP+ | Manage flaky cases and escalation paths. | partial | incident and recertification flows, W7-S03 | W19-S04 |
| RQA-06 | Reviewer / QA | Later | Make review decisions explicit across quality and delivery gates. | partial | W13-S05 review closure, W14-S06 audit alignment | W19-S05, W21-S06 |
| AIP-01 | AI platform owner | MVP | Manage prompt bundles as platform assets. | covered | prompt bundles, asset loader, W2-S02 | none |
| AIP-02 | AI platform owner | MVP | Manage context docs, rules, skills, and bundles. | covered | context assets, compiled context, W8-S08, W8-S09 | none |
| AIP-03 | AI platform owner | MVP | Manage wrappers, routes, and policies. | covered | route, wrapper, and policy registries, W2 | none |
| AIP-04 | AI platform owner | MVP | Manage adapters and capability metadata. | covered | adapter SDK, adapter contracts, W16-S06 | none |
| AIP-05 | AI platform owner | MVP | Manage compiler revisions as platform assets. | partial | compiled-context runtime foundation | W20-S04 |
| AIP-06 | AI platform owner | MVP | Run certification before promotion. | covered | `harness certify`, promotion decisions, W3-S05 | none |
| AIP-07 | AI platform owner | MVP+ | Compare new candidates against stable baselines. | covered | W7-S02 promotion/freeze maturity | none |
| AIP-08 | AI platform owner | MVP+ | Freeze problematic platform assets. | covered | `asset freeze`, W7-S02 | none |
| AIP-09 | AI platform owner | MVP+ | Demote or re-enable assets through incident evidence. | covered | incident recertification, W7-S03 | none |
| AIP-10 | AI platform owner | MVP+ | Link promotion decisions to finance evidence. | covered | W7-S02, W7-S04 finance evidence | none |
| AIP-11 | AI platform owner | Later | Compare later-stage baselines across candidates. | covered | W8-S05 baseline comparison maturity | none |
| AIP-12 | AI platform owner | Later | Certify extended adapters such as OpenCode as live baselines. | blocked | OpenCode is extended non-live-baseline coverage | W20-S03 |
| OPS-01 | Operator / SRE | MVP | Watch live run state in CLI or web. | covered | `run status`, API read surface, web console, W5 | none |
| OPS-02 | Operator / SRE | MVP | Tail logs and inspect live events. | covered | live event stream, `evidence show`, W5-S02 | none |
| OPS-03 | Operator / SRE | MVP | Inspect policy and compile decisions. | covered | W8-S04 policy visibility, compiled context evidence | none |
| OPS-04 | Operator / SRE | MVP | Approve risky actions with durable evidence. | partial | handoff approve, review reports, audit records | W19-S05, W21-S06 |
| OPS-05 | Operator / SRE | MVP | Replay failures through the Runtime Harness. | covered | `harness replay`, W9-S05 | none |
| OPS-06 | Operator / SRE | MVP | Review installed-user black-box proof evidence. | covered | W12 proof runner, W14 proof bundles | none |
| OPS-07 | Operator / SRE | MVP | Run curated full-journey live acceptance on real repositories. | covered | W14 coverage_with_findings proof on curated matrix repositories | none |
| OPS-08 | Operator / SRE | MVP | Select required matrix cells by scenario, provider, and feature size. | covered | W14 scenario/provider/feature-size matrix | none |
| OPS-09 | Operator / SRE | MVP+ | Inspect policy and audit guardrails for run controls. | covered | W6-S03 run-control audit guardrails | none |
| OPS-10 | Operator / SRE | Later | Use richer event, policy, and production observability views. | partial | W8-S04 operator visibility | W19-S06, W20-S02, W21-S05 |
| SEC-01 | Security / compliance | MVP | Enforce provider and adapter allowlists. | covered | route policies, adapter capability validation, W2-S03, W8-S03 | none |
| SEC-02 | Security / compliance | MVP | Apply secret-safe logging and redaction. | partial | W10-S04 auth hardening baseline | W20-S02 |
| SEC-03 | Security / compliance | MVP | Preserve audit trails for approvals, overrides, and route changes. | covered | audit records, W6-S03, W7-S04 | none |
| SEC-04 | Security / compliance | MVP | Use stricter gates for higher-risk flows. | covered | step policies, delivery guards, W8-S03 | none |
| SEC-05 | Security / compliance | MVP+ | Govern route and policy overrides. | covered | W6-S03 run-control policy guardrails | none |
| SEC-06 | Security / compliance | Later | Harden production transport, logging, and redaction. | partial | detached transport auth baseline | W20-S02 |
| RMO-01 | Repository / multirepo owner | MVP | Describe monolith or bounded multirepo topology. | covered | project profile topology, W8-S07 | none |
| RMO-02 | Repository / multirepo owner | MVP | Track repo graph and ownership. | partial | project analysis and multirepo maturity docs | W20-S01 |
| RMO-03 | Repository / multirepo owner | MVP | Use scoped locks for coordinated work. | gap | no dedicated scoped-lock subsystem | W20-S01 |
| RMO-04 | Repository / multirepo owner | MVP | Run cross-repo validation before coordinated delivery. | gap | multirepo delivery maturity baseline only | W20-S01 |
| RMO-05 | Repository / multirepo owner | MVP+ | Prepare bounded multirepo delivery and release evidence. | partial | W6-S05, W8-S07 delivery rerun maturity | W20-S01 |
| RMO-06 | Repository / multirepo owner | Later | Mature multirepo delivery orchestration and reruns. | partial | W8-S07 later multirepo maturity | W20-S01 |
| INC-01 | Incident / improvement owner | MVP | Open incident reports from failed runs or releases. | covered | `incident open`, W6-S06 | none |
| INC-02 | Incident / improvement owner | MVP | Force recertification before re-enabling problematic routes. | covered | `incident recertify`, W7-S03 | none |
| INC-03 | Incident / improvement owner | MVP | Correlate incidents with routes, assets, wrappers, adapters, or compiler revisions. | partial | incident reports and learning-loop handoffs | W19-S04, W20-S04 |
| INC-04 | Incident / improvement owner | MVP+ | Use controlled re-enable after recertification. | covered | W7-S03 controlled re-enable flow | none |
| INC-05 | Incident / improvement owner | MVP+ | Backfill incidents into datasets and suites. | gap | learning handoff creates evidence but not reviewed backfill proposals | W19-S04 |
| INC-06 | Incident / improvement owner | Later | Close the production feedback loop into monitoring and learning. | partial | W8-S06 incident maturity | W20-S05 |
| PBO-01 | Project bootstrap / onboarding | MVP | Run project analysis. | covered | `project analyze`, W1-S03 | none |
| PBO-02 | Project bootstrap / onboarding | MVP | Run deterministic project validation. | covered | `project validate`, W1-S04 | none |
| PBO-03 | Project bootstrap / onboarding | MVP | Run bounded project verification. | covered | `project verify`, W1-S05 | none |
| PBO-04 | Project bootstrap / onboarding | MVP | Materialize project-analysis reports with boundaries and risk zones. | covered | project-analysis reports, W1-S03 | none |
| PBO-05 | Project bootstrap / onboarding | MVP | Block execution when prerequisites are missing. | covered | verify/preflight reports, W1-S05 | none |
| PBO-06 | Project bootstrap / onboarding | MVP+ | Recommend missing AOR-native runtime context assets. | covered | W6-S02, W8-S08, W8-S09 | none |
| PBO-07 | Project bootstrap / onboarding | MVP+ | Track project-profile coverage and missing source material. | partial | project profile validation, intake baseline | W19-S01, W19-S02, W21-S03, W21-S04 |
| PBO-08 | Project bootstrap / onboarding | Later | Support later bootstrap maturity for reruns and multirepo work. | partial | W8-S07 bootstrap and delivery rerun maturity | W19-S03, W20-S01, W21-S03 |
| DTX-01 | Delivery transaction / Git / PR | MVP | Deliver output through patch-only mode. | covered | delivery driver, `deliver prepare`, W4-S03, W6-S05 | none |
| DTX-02 | Delivery transaction / Git / PR | MVP | Deliver output through local-branch mode. | covered | local branch delivery driver, W4-S03 | none |
| DTX-03 | Delivery transaction / Git / PR | MVP | Prepare fork-first-pr delivery under bounded policy. | covered | fork-first driver, W4-S04, W10-S02 | none |
| DTX-04 | Delivery transaction / Git / PR | MVP | Produce manifests linking execution to write-back artifacts. | covered | delivery manifests, W4-S05, W11-S04 | none |
| DTX-05 | Delivery transaction / Git / PR | MVP | Isolate parallel runs with worktree and branch semantics. | covered | isolated worktree foundation, W4-S01 | none |
| DTX-06 | Delivery transaction / Git / PR | MVP+ | Rerun from a packet boundary or failed step. | covered | W8-S07 delivery rerun maturity | none |
| DTX-07 | Delivery transaction / Git / PR | MVP+ | Prepare release evidence from delivery artifacts. | covered | `release prepare`, W6-S05 | none |
| DTX-08 | Delivery transaction / Git / PR | Later | Coordinate bounded multirepo delivery manifests. | partial | W8-S07 multirepo delivery maturity | W20-S01 |
| FIN-01 | Finance / audit / hygiene | MVP | Track cost by route, bundle, compiler revision, adapter, and project. | partial | finance evidence and audit records | W20-S05 |
| FIN-02 | Finance / audit / hygiene | MVP | Track latency by route, bundle, compiler revision, adapter, and project. | partial | run/audit timing evidence | W20-S05 |
| FIN-03 | Finance / audit / hygiene | MVP | Preserve durable evidence for reviews and audits. | covered | audit records, evidence show, W7-S04 | none |
| FIN-04 | Finance / audit / hygiene | MVP | Keep audit evidence queryable from command and API surfaces. | covered | `audit runs`, API read surface, W7-S04 | none |
| FIN-05 | Finance / audit / hygiene | MVP+ | Link promotion and freeze decisions to finance evidence. | covered | W7-S02, W7-S04 | none |
| FIN-06 | Finance / audit / hygiene | MVP+ | Expand finance evidence durability. | covered | W7-S04 finance evidence expansion | none |
| FIN-07 | Finance / audit / hygiene | MVP+ | Make platform hygiene visible through regression signals. | partial | W7-S01, W7-S04, W8-S09 | W20-S05 |
| FIN-08 | Finance / audit / hygiene | Later | Distinguish production monitoring from offline certification. | gap | audit and proof evidence exist, production monitoring loop does not | W20-S05 |
