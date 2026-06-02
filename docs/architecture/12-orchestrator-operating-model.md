# Orchestrator operating model

## Purpose
This is the most concrete description of how AOR should operate day to day.

## Core idea
AOR is the durable SDLC control plane that coordinates:
- project context,
- packets,
- approvals,
- routed execution,
- quality evidence,
- delivery transactions,
- platform-asset evolution,
- incident learning.

Repository contributor guidance such as `AGENTS.md` and `.agents/**` belongs to AOR development workflow only. Runtime AOR flows consume only AOR-owned versioned assets, packets, and project-profile references.

## Runtime Harness boundary
The AOR Runtime Harness is the mandatory internal controller for normal AOR runtime. It is not Live E2E and it is not the `aor harness certify` command.

For every routed adapter-backed step, the Runtime Harness owns:
`prepare -> execute step -> classify outcome -> validate mission semantics -> decide -> retry/repair/escalate if needed -> verify -> close/block`.

The Runtime Harness writes step-level decision evidence and a completed-run `runtime-harness-report`. It diagnoses AOR runtime quality: whether AOR prepared the right context, invoked the adapter, interpreted the result, enforced mission semantics, bounded repair, and closed or blocked the flow correctly.

As of W24-S01, normal `run start` execution uses a run-level Runtime Harness controller. The controller owns the run-stage ledger (`prepare`, `execute`, `classify`, `validate`, `retry`/`repair`/`escalate`, `verify`, `close`/`block`) and delegates routed step execution to the step engine. Controller-generated reports add `run_controller`, `run_transitions`, and `run_decision` so pass, block, fail, repair, and exhausted-repair outcomes are visible at run level without provider-specific behavior entering core.

Quality boundaries are explicit:
- feature result quality is owned by review, eval, delivery, and release evidence;
- AOR runtime quality is owned by Runtime Harness decisions and `runtime-harness-report`;
- installed-user black-box proof is owned by Live E2E summaries;
- learning-loop quality is owned by learning scorecard and handoff artifacts;
- asset lifecycle quality is owned by certification evidence and `promotion-decision`.

## Canonical operating units
- **Project profile** — persistent project defaults.
- **Project analysis report** — repeatable onboarding knowledge.
- **Packet chain** — discovery through release.
- **Flow projection** — control-plane view over one mission/intake lineage,
  latest next action, run/review/delivery/release/learning evidence, and
  operator-request summaries.
- **Run and step results** — normalized execution state.
- **Operator request** — durable operator-initiated intervention intent that can be compiled into a routed step without becoming direct chat.
- **Quality evidence** — validation, eval, harness, logs, traces, and diffs.
- **Delivery plan** — pre-write policy decision and gate status.
- **Delivery manifest** — actual delivery transaction.
- **Learning memory** — incidents, datasets, suites, and promotion decisions.

## Standard operating modes
- project bootstrap
- discovery-only
- planning-only
- execution-only from approved handoff
- repair-only from a failed step
- evaluation-only
- harness-only
- full end-to-end rehearsal
- full end-to-end rehearsal from curated feature mission
- installed-user local app intake, where `aor app` serves the packaged SPA on loopback and the UI drives only control-plane-owned lifecycle mutations
- operator-request intervention, where CLI/API/web create a scoped `operator-request`, compile it into the selected runtime step, and emit proposal/patch evidence without bypassing policies

## Detailed execution pattern
1. load the project profile and target repository information;
2. analyze or verify the project if required;
3. optionally launch the local packaged UI with `aor app` for readiness, Mission intake, next-action, and evidence inspection;
4. materialize the next packet boundary and, for W34 flow-centric surfaces,
   derive the selected flow from runtime/control-plane evidence;
5. request human approval if the policy requires it;
6. if the operator asks for analysis, document changes, repair, validation, planning, implementation, or review, persist an `operator-request` with target refs, allowed paths, delivery mode, and source surface before any runtime work starts;
7. prepare the routed step by resolving route, wrapper, prompt bundle, context assets, step policy, and compiled context. Operator-request runs add `packet://operator-request@...` to input packet refs and overlay `context-bundle://context.bundle.operator-intervention@v1`;
8. execute the step through the selected adapter;
9. classify the adapter/runtime outcome into stable failure classes;
10. validate mission semantics, including expected evidence, diff scope, delivery lineage, and release lineage;
11. decide whether to pass, retry, repair, escalate, block, or fail;
12. run deterministic verification and eval when the step policy requires it;
13. persist step decision evidence and update the run-level Runtime Harness report;
14. if the flow reaches delivery, materialize a delivery plan before any write-back path starts;
15. only if the delivery plan is ready and mission semantics are closed, materialize a delivery manifest;
16. if the flow reaches release, materialize a release packet;
17. run review, audit, and learning closure surfaces before declaring the run complete;
18. if the flow fails materially, open or update an incident path.

The local app path is an operator surface, not a runtime dependency. It serves `/`, `/app-config.json`, and same-origin `/api/projects/:projectId/**` routes from the CLI-launched process, then invokes the same lifecycle-command handlers as the CLI. Stopping the app server must not stop runs or mutate workflow state beyond the explicit commands the operator submitted.

Flow projections are read models, not a new orchestration owner. Active flows
can advance only through the existing runtime command path. Completed flows
remain read-only. Follow-up flows start from fresh mission/intake evidence and
may cite a learning handoff from the completed source flow.

Operator requests are explicit runtime inputs, not free-form steering. The default `delivery_mode=no-write` produces analysis or proposal evidence only. `patch-only` requires explicit `allowed_paths` and produces patch evidence without silently mutating source files in v1. Higher delivery modes remain governed by the existing delivery plan, review, promotion, and writeback gates.

Strictness is mission-type driven. Code-changing, live, and release missions use strict semantic gates. Docs-only, no-write rehearsal, and asset-certification flows may use softer profiles, but their softness must be explicit in runtime evidence.

When classification finds `interactive-question-requested`, the run is not terminal by UI decision. The Runtime Harness writes a resumable `requested_interaction` boundary into the step result, emits query-safe live events, and waits for a control-plane-owned answer submission. After answer audit evidence is written, the runtime resumes from that boundary when `continuation.next_action=resume_from_boundary`; if validation, policy, or an unsupported boundary blocks continuation, the run remains blocked with the same interaction, `state_history[]`, and reason evidence.

## Delivery model
AOR should support these delivery modes:
- `no-write`
- `patch-only`
- `local-branch`
- `fork-first-pr`

All non-trivial delivery modes should leave a delivery manifest behind.
Delivery-capable runs should execute from an isolated root (`workspace-clone` or `worktree`) rather than mutating the operator's primary checkout directly.

Policy boundary between rehearsal and delivery:
- rehearsal can proceed in `no-write` mode without handoff/promotion gates;
- non-`no-write` delivery modes must be blocked unless approved handoff evidence and promotion evidence are both present;
- strict code-changing and release delivery must be blocked unless the latest Runtime Harness report contains routed step decisions, `overall_decision=pass`, and at least one meaningful implementation changed path;
- write-back is allowed only when the delivery plan status is `ready`.

## Asset evolution model
Prompt bundles, runtime context assets, wrappers, routes, policies, adapters, and compiler revisions evolve on their own lifecycle:
- draft → candidate → stable → frozen/demoted

Promotion must be based on certification evidence, not intuition.

## Incident learning loop
When a run fails or a release causes trouble:
1. create an incident report;
2. link the incident to run, route, wrapper, prompt/context assets, adapter, compiler revision, and packets;
3. create a reviewed incident-backfill proposal for the target dataset or suite;
4. update or create suites only after proposal review accepts the change;
5. recertify the impacted platform asset before restoring it to stable use.

For full-journey live E2E, the same loop must also leave behind:
- a feature-linked review verdict;
- a learning-loop scorecard;
- a learning-loop handoff that points backlog follow-up back to the curated mission and target repo;
- matrix-cell traceability for scenario family, provider variant, and declared feature size.

Learning handoff aggregates evidence refs and next actions. It may recommend backlog, eval, incident, or asset-recertification follow-up, but it does not replace feature review, Runtime Harness diagnosis, or asset certification decisions.
