# Quiet Cockpit console benchmarks

- **Reviewed:** 2026-07-14
- **Scope:** interaction patterns for a local, evidence-backed SDLC operator
  console.
- **Use:** directional benchmark only. AOR contracts, safety invariants, and
  headless ownership take precedence over every external pattern.

## Decision summary

Quiet Cockpit should combine four proven console patterns without copying any
one product's information architecture:

1. a calm current-state summary with one primary action;
2. an inbox-like queue for work that genuinely requires attention;
3. a workflow journey that separates current status from historical evidence;
4. a detail view that keeps durable artifacts, decisions, and history
   inspectable on demand.

These patterns remain presentation guidance. They do not authorize browser-only
lifecycle state, hidden blockers, non-durable snooze semantics, or UI-owned
orchestration.

## Primary-source benchmark register

| Benchmark | Observed pattern | AOR use | Boundary |
|---|---|---|---|
| [Linear Inbox](https://linear.app/docs/inbox) | Selectable list/detail workflow, keyboard traversal, quick filtering, and actions attached to the selected item. | Attention should support deterministic selection, independent item context, keyboard movement, and one relevant action. | Do not copy snooze until AOR has durable defer semantics; a browser preference must never hide a runtime blocker. |
| [Sentry Issue Details](https://docs.sentry.dev/product/issues/issue-details/) | High-signal header, impact/context summary, chronological activity, and progressively disclosed diagnostic evidence. | Attention and Evidence should lead with consequence and decision context, then expose technical refs, history, and raw data. | Do not import Sentry's issue grouping or event recommendation semantics into AOR evidence lineage. |
| [GitHub Actions workflow monitoring](https://docs.github.com/en/actions/how-tos/monitor-workflows) | A live workflow graph is paired with job/step status, history, and searchable logs. | Journey can pair lifecycle/task progress with focused run inspection and explicit evidence links. | A graph is not the only view; AOR must retain a keyboard-friendly list/table alternative and must not equate visual completion with accepted evidence. |
| [Grafana alert state](https://grafana.com/docs/grafana/latest/alerting/monitor-status/view-alert-state/) | State, health, instances, history, and detail are separate concepts and views. | Attention must distinguish a work item's status, severity/consequence, source health, and history instead of compressing them into one color. | Do not use a worst-state summary as the only truth or hide individual AOR blockers behind aggregate health. |
| [Temporal UI](https://github.com/temporalio/ui) | Durable workflow executions are searchable and inspectable through execution state and event history. | Journey and Evidence should preserve one flow identity across current execution, retries, repair, and durable history. | AOR remains runner-agnostic and packet-first; it must not adopt Temporal-specific workflow or persistence semantics. |

## AOR-specific synthesis

| Quiet Cockpit surface | Primary benchmark | AOR-specific requirement |
|---|---|---|
| Cockpit | Sentry header/detail hierarchy | Show authoritative current state, one safe action, blockers, and concise safety context before evidence. |
| Attention | Linear Inbox and Grafana alert views | Use stable flow-scoped item identity, deterministic ordering, explicit consequence, source refs, and durable completion readback. |
| Journey | GitHub Actions and Temporal UI | Keep lifecycle, task/run, and evidence depths distinct; partial child success must not become aggregate success. |
| Evidence | Sentry activity/detail and Temporal history | Present existing packet/report/decision lineage; do not create a second evidence store or browser-only case file. |

## Review checklist

Use the external references only after checking the AOR sources of truth:

- `docs/product/05-quiet-cockpit-console-design.md`
- `docs/product/02-installed-user-onboarding-journey.md`
- `docs/product/04-project-topology-and-task-planning-ux.md`
- `docs/architecture/12-orchestrator-operating-model.md`
- `docs/contracts/control-plane-api.md`
- `docs/contracts/next-action-report.md`

For every borrowed pattern, reviewers must answer:

1. Which AOR packet, report, projection, or route owns the displayed state?
2. Can the same outcome still be completed headlessly?
3. Does the pattern retain partial, stale, offline, permission, and blocked
   states without turning them into healthy emptiness?
4. Is the visible action's label identical to its actual side effect?
5. Is the pattern usable with keyboard, zoom/reflow, reduced motion, and a
   narrow viewport?
6. Does it preserve no-upstream-write defaults and completed-flow immutability?
