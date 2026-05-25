# W32 - operator-request interactive runtime flow

Add runtime-owned interactive intervention so an operator can ask AOR to analyze,
explain, revise, repair, validate, plan, implement, or review bounded artifacts
from any flow stage without turning the UI into a direct agent chat.

## Wave objective

Make operator-initiated requests durable, scoped, policy-checked runtime inputs
that compile through the existing context and routed execution machinery, while
remaining available from CLI, API, and the local web console.

## Wave exit criteria

- W32 is represented across the roadmap, master backlog, epic map, dependency
  graph, and owning wave doc.
- The `operator-request` contract validates request scope, intent, stage,
  delivery mode, sanitized summaries, result refs, and evidence refs.
- CLI commands `aor request create`, `aor request run`, and
  `aor request status` create, execute, and inspect durable request evidence.
- HTTP routes list, create, and run operator requests with query-safe read
  payloads and refreshed next-action reports after execution.
- The local app exposes Ask AOR/request-change controls from every stage,
  Evidence & Documents targeting, and an Interactions Inbox for runtime-owned
  continuation answers.
- README, product stories, architecture, contracts, ops runbooks, live E2E
  docs, and npm alpha release docs describe the operator-request path.

---

## W32-S01 — Operator-request interactive runtime flow
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** An operator can create a bounded request from UI, CLI, or API, route it through runtime context compilation, and receive proposal/patch evidence plus a refreshed next action without direct upstream writes by default.
- **Primary modules:** `packages/contracts/**`, `packages/orchestrator-core/**`, `apps/web/**`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `docs/backlog/**`, `examples/**`, `scripts/**`
- **Hard dependencies:** W31-S01, W24-S02
- **Primary user story surfaces:** OPS-11, OPS-04, DEV-05, RQA-02.

### Local tasks
1. Add the `operator-request` contract family, canonical example, and
   operator-intervention context rule/bundle.
2. Implement shared runtime services for create, list, status, run, sanitized
   read payloads, and no-write/patch evidence materialization.
3. Add CLI commands `request create`, `request run`, and `request status`
   without expanding `run steer` into free-form runtime work.
4. Add control-plane list/create/run routes and OpenAPI/module-surface
   coverage.
5. Rework the SPA into a dense operator-console layout with stage-level Ask AOR,
   request drawer, Evidence & Documents workbench, and Interactions Inbox.
6. Update README, user stories, installed-user journey, architecture, contracts,
   ADRs, runbooks, release docs, backlog, and live E2E fixture/docs.
7. Add contract, runtime, CLI, API, and web coverage for happy paths and policy
   failures.

### Acceptance criteria
1. Invalid intent, target stage, delivery mode, and patch-only-without-scope
   inputs fail deterministically.
2. `aor request create --json` writes an `operator-request` artifact and emits
   sanitized output with `delivery_mode=no-write` by default.
3. `aor request run --json` routes the request through compiled context,
   returns `operator_request_ref`, `run_id`, `routed_step_result_file`,
   `compiled_context_ref`, proposal/patch refs, and `next_action_report_file`.
4. `GET /api/projects/:projectId/operator-requests` omits raw request text but
   preserves summaries, status, refs, result refs, and evidence refs.
5. The SPA renders Ask AOR on every stage, attaches evidence/docs refs as
   request targets, submits requests, shows result/evidence refs, and keeps
   runner-requested interactions separate in the inbox.
6. No-write requests produce analysis/proposal evidence only; patch-only
   requests require explicit allowed paths and produce patch evidence without
   silently mutating target files.

### Done evidence
- `packages/contracts/src/families.mjs`
- `docs/contracts/operator-request.md`
- `examples/reports/operator-request.canonical.yaml`
- `examples/context/rules/operator-intervention.yaml`
- `examples/context/bundles/operator-intervention.yaml`
- `packages/orchestrator-core/src/operator-request.mjs`
- `packages/orchestrator-core/src/operator-cli/command-handlers/request.mjs`
- `packages/orchestrator-core/src/control-plane/http/**`
- `apps/web/src/spa.jsx`
- `apps/web/src/spa.css`
- `packages/orchestrator-core/test/operator-request.test.mjs`
- `apps/web/test/operator-request-spa.test.mjs`
- `examples/live-e2e/fixtures/w32-s01/operator-request-interactive-flow.sample.json`
- updated README, product, architecture, contract, ADR, ops, release, and
  backlog docs

### Out of scope
- A separate prompt compiler for operator requests.
- Direct silent source mutation from the UI.
- Making the web UI mandatory.
- Replacing `run answer` for runtime-initiated questions.
- Hosted SaaS, cross-tenant collaboration, or upstream write-back by default.
