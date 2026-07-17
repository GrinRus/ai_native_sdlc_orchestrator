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

Project context is immutable after ingress. It binds one runtime project id to
canonical project, runtime, project-runtime, and profile paths plus a stable
registry identity. Long-lived processes retain one separate context per
selected project; there is no ambient current project. Compatibility wrappers
may translate the context to legacy `{cwd, projectRef, runtimeRoot}` arguments
once, with `cwd` anchored to the project root rather than the launcher.

The topology vocabulary is also explicit: a Local Workspace contains
independent AOR Projects; each Project owns portable Repository and Component
definitions; a Project Binding owns machine-local checkout resolution; and a
Workspace Set freezes exact repository identities for a later run. Components
inside a monorepo never become synthetic Git repositories.

At run start, workspace-set schema v2 resolves every binding and base ref
before writing, provisions one isolated worktree or independent clone per
repository, and publishes a run-owned manifest with exact commits, mounts,
execution roots, cleanup ownership, and repository-local Git evidence.
Execution and downstream quality/delivery stages use that manifest rather than
launcher state or the operator's primary checkout.

An approved structured task plan is then materialized as execution-plan schema
v2. The plan maps every task exactly once to a unit or explicit non-run entry,
derives repository/component impact, preserves dependency order, assigns unit
and integration verification, and records why each unit is a parallel
candidate or must remain serialized. Parallel candidacy is planning evidence;
only the bounded scheduler may start work.

The scheduler persists one parent-run projection bound to the approved
execution-plan digest and ready run-owned workspace set. Each runnable unit is
reserved atomically and launched through the existing durable run-job worker,
so adapters, permissions, retries, repair, evidence, and Runtime Harness
semantics remain child-run concerns. Dependency order, conflict keys,
`max_concurrency`, provider/tool capacity, and child-start budgets govern the
ready queue. Parent completion additionally requires all integration gates;
partial child success is never mission closure.

Integration consumes only immutable child patch/commit evidence in dependency
order inside a separate disposable workspace. Its report owns aggregate
verification/review/QA gates, transitive stale boundaries, retained recovery
state, and bounded repair lineage. Write-capable bounded multirepo delivery
requires that passing integration report and emits one manifest-v2 aggregate
transaction plus exact per-repository stages; partial effects remain aggregate
failure until explicit recovery. `pnpm w62:proof` composes these invariants for
monorepo components and a bounded contract-dependent multirepo without provider
network or upstream writes.

The default Local Workspace registry is persisted under AOR-owned user state,
uses atomic revisioned writes, and stores only explicitly connected projects
and redacted bindings. Reads never scan the filesystem. A neutral launcher has
no selected project; an attached repository is a current-session selection
rather than a persisted ambient project.

Query ingress derives an immutable `ProjectReadContext` from that project
context and a non-materializing runtime preview. It resolves the same canonical
paths but represents missing runtime state as `initialized=false`; it never
creates `.aor`, generated profiles, reports, packets, or recovery state. Only
explicit onboarding and initialization mutations cross the materialization
boundary.

Repository contributor guidance such as `AGENTS.md` and `.agents/**` belongs to AOR development workflow only. Runtime AOR flows consume only AOR-owned versioned assets, packets, and project-profile references.

## Runtime Harness boundary
The AOR Runtime Harness is the mandatory internal controller for normal AOR runtime. It is not installed-user rehearsal and it is not the `aor harness certify` command.

For every routed adapter-backed step, the Runtime Harness owns:
`prepare -> execute step -> classify outcome -> validate mission semantics -> decide -> retry/repair/escalate if needed -> verify -> close/block`.

The Runtime Harness writes step-level decision evidence and a completed-run `runtime-harness-report`. It diagnoses AOR runtime quality: whether AOR prepared the right context, invoked the adapter, interpreted the result, enforced mission semantics, bounded repair, and closed or blocked the flow correctly.

As of W24-S01, normal `run start` execution uses a run-level Runtime Harness controller. The controller owns the run-stage ledger (`prepare`, `execute`, `classify`, `validate`, `retry`/`repair`/`escalate`, `verify`, `close`/`block`) and delegates routed step execution to the step engine. Controller-generated reports add `run_controller`, `run_transitions`, and `run_decision` so pass, block, fail, repair, and exhausted-repair outcomes are visible at run level without provider-specific behavior entering core.

As of W58-S05, the HTTP lifecycle `run start` boundary is asynchronous. It
reserves a durable `run-job`, starts a separate Node worker, and returns HTTP
`202` with run, job, status, and event references before provider execution
finishes. The worker owns heartbeat and terminal evidence updates under
revision checks. Pause, answer, and cancel remain durable run-control actions;
cancel performs bounded process-group cleanup. Module callers retain an inline
compatibility wrapper while migrating to the accepted-response boundary.

Live observation is journal-first rather than process-local. API SSE and the
real CLI `run status --follow` tail the per-run JSONL journal from a durable
cursor. Reconnect resumes after `after_event_id`, replay is explicitly bounded,
and slow clients disconnect with a recovery cursor instead of creating an
unbounded memory queue.

Quality boundaries are explicit:
- feature result quality is owned by review, eval, delivery, and release evidence;
- AOR runtime quality is owned by Runtime Harness decisions and `runtime-harness-report`;
- installed-user black-box proof is owned by internal maintainer rehearsal summaries;
- learning-loop quality is owned by learning scorecard and handoff artifacts;
- asset lifecycle quality is owned by certification evidence and `promotion-decision`.

## Canonical operating units
- **Project profile** — persistent project defaults.
- **Project analysis report** — repeatable onboarding knowledge.
- **Packet chain** — discovery through release.
- **Structured task plan** — versioned mission-specific tasks, criteria,
  dependencies, scope, verification, expected evidence, risks, and stop
  conditions stored in `wave-ticket` and copied into `handoff-packet`.
- **Execution plan** — immutable approved task-to-unit mapping.
- **Task progress report** — evidence-derived task, unit, and attempt state;
  adapter success alone never means task completion.
- **Flow projection** — control-plane view over one mission/intake lineage,
  latest next action, run/review/delivery/release/learning evidence, and
  operator-request summaries.
- **Run and step results** — normalized execution state.
- **Operator request** — durable operator-initiated intervention intent that can be compiled into a routed step without becoming direct chat.
- **Quality repair request** — durable review/QA repair intent with source
  findings, repair scope, attempt budget, status, blockers, and evidence refs.
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
- quality-repair from review or QA findings
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
5. for planning, invoke the runner-agnostic planning route and accept a
   structured candidate without allowing provider output to write runtime
   artifacts directly;
6. normalize and deterministically validate the candidate, then materialize
   plan, wave, handoff, and validation evidence; run the semantic evaluator
   only after structural pass;
7. request approval for the exact plan version and digest, then materialize an
   immutable execution plan;
8. if the operator asks for analysis, document changes, repair, validation, planning, implementation, or review, persist an `operator-request` with target refs, allowed paths, delivery mode, and source surface before any runtime work starts;
9. prepare the routed step by resolving route, wrapper, prompt bundle, context assets, step policy, compiled context, and optional execution-unit/task refs. Operator-request runs add `packet://operator-request@...` to input packet refs and overlay `context-bundle://context.bundle.operator-intervention@v1`;
10. execute the step through the selected adapter;
11. classify the adapter/runtime outcome into stable failure classes;
12. validate mission semantics, including expected evidence, diff scope, delivery lineage, and release lineage;
13. decide whether to pass, retry, repair, escalate, block, or fail;
14. run deterministic verification and eval when the step policy requires it;
15. project task progress from current-plan criteria, verification, evidence,
   blocking findings, and attempt refs;
16. persist step decision evidence and update the run-level Runtime Harness report;
17. if the flow reaches delivery, materialize a delivery plan before any write-back path starts;
18. only if the delivery plan is ready and mission semantics are closed, materialize a delivery manifest;
19. if the flow reaches release, materialize a release packet;
20. run review, audit, and learning closure surfaces before declaring the run complete;
21. if the flow fails materially, open or update an incident path.

The local app path is an operator surface, not a runtime dependency. It serves `/`, `/app-config.json`, and same-origin `/api/projects/:projectId/**` routes from the CLI-launched process, then invokes the same lifecycle-command handlers as the CLI. Stopping the app server must not stop runs or mutate workflow state beyond the explicit commands the operator submitted.

Execution setup follows the same headless boundary. Portable route selections
live only in `project-profile.default_route_profiles`; the derived
`execution-profile` resolves canonical route and adapter metadata for reads.
Explicit readiness checks write credential-free summaries to the machine-local
Workspace registry. Reads do not initialize project runtime, and route
selection, model compatibility, runner/auth readiness, capability, and policy
failures are resolved before any provider process can spawn.

Core application entrypoints are stable, bounded facades. Routed execution,
review-report materialization, and CLI command-family dispatch delegate to
transport-neutral implementations; HTTP, CLI, and the app launcher remain
one-way adapters and never become orchestration owners. Repository quality
checks enforce the facade size ceiling and the transport dependency boundary.

Flow projections are read models, not a new orchestration owner. Active flows
can advance only through the existing runtime command path. Completed flows
remain read-only. Follow-up flows start from fresh mission/intake evidence and
may cite a learning handoff from the completed source flow.

Operator requests are explicit runtime inputs, not free-form steering. The default `delivery_mode=no-write` produces analysis or proposal evidence only. `patch-only` requires explicit `allowed_paths` and produces patch evidence without silently mutating source files in v1. Higher delivery modes remain governed by the existing delivery plan, review, promotion, and writeback gates.

Strictness is mission-type driven. Code-changing, live, and release missions use strict semantic gates. Docs-only, no-write rehearsal, and asset-certification flows may use softer profiles, but their softness must be explicit in runtime evidence.

## Quality repair operating model

W45 public repair cycles start from review or QA evidence and materialize one
`quality-repair-request`. The request records the source stage, source report
ref, finding refs, repair scope, cycle id, policy-derived attempt budget,
current status, blockers, and evidence refs. The request is shared by review
and QA so downstream gates do not need separate repair vocabularies.

Allowed statuses are:
- `requested` after review or QA asks for repair and before repair execution
  starts;
- `in-progress` while the repair implementation step is running or pending
  completion;
- `review-required` after any repair attempt completes;
- `qa-required` after post-repair review passes when QA is in scope;
- `budget-exhausted` when the policy-derived attempt budget is spent;
- `closed` after review and required QA evidence prove closure.

The allowed state machine is bounded:
`implement -> review -> repair -> review -> qa -> repair -> review -> qa`.
Every repair attempt must return through review. When QA is in scope, a passing
post-repair review must be followed by QA before delivery can become ready.
Cycle budgets come from project profile or selected runtime policy; reports
copy the resolved budget but do not hardcode a default.

Delivery and release remain blocked while a required repair request is
`requested`, `in-progress`, `review-required`, `qa-required`, or
`budget-exhausted`. `budget-exhausted` is a terminal blocker for the automatic
loop and requires explicit operator approval evidence before downstream
delivery/release can continue.

Post-run primary or diagnostic verification failures are repair-source evidence
when the selected implementation-loop policy declares those sources. They must
route through the same public request-repair path instead of failing execution
before review can materialize repair context. Verification-mapping-only review
warnings with passing primary verification are not actionable repair requests on
their own; they stay review evidence for QA/delivery inspection unless another
implementation finding requires repair.

Repair-profile acceptance is fail-closed. If a selected live profile declares
`implementation_loop.proof_expectations`, terminal run evidence must include the
materialized `quality_repair_request`, repair implementation refs, review rerun
refs, QA rerun refs when QA is in scope, and closed-request evidence before the
run can be treated as repair-loop acceptance.

Repair implementation uses normal routed execution. During prepare, the context
compiler adds the materialized repair request as a packet/evidence ref in the
compiled context. Prompt bundles receive the request ref, finding refs, required
evidence refs, and attempt budget through provider-agnostic compiled context,
not through ad hoc chat text or private harness vocabulary.

Post-run verification may accept a failed target command only when an explicit
baseline verify summary proves the same command failure was pre-existing. The
current step-result must keep `baseline_failure_status=pre_existing` and
`baseline_failure_evidence_refs[]`; verify summaries aggregate the match under
`verification_failure_baseline_matches[]`. This is broken-baseline evidence, not
repair closure evidence, and it must not satisfy W45 repair-proof expectations
unless a real `quality-repair-request` was materialized and closed.

When classification finds `interactive-question-requested`, the run is not terminal by UI decision. The Runtime Harness writes a resumable `requested_interaction` boundary into the step result, emits query-safe live events, and waits for a control-plane-owned answer submission. After answer audit evidence is written, the runtime resumes from that boundary when `continuation.next_action=resume_from_boundary`; if validation, policy, or an unsupported boundary blocks continuation, the run remains blocked with the same interaction, `state_history[]`, and reason evidence.

## Adapter and internal rehearsal boundaries

The adapter SDK keeps process supervision, packet transport, permission
projection, and evidence normalization in provider-neutral leaf modules.
Provider-specific stream interpretation stays inside the adapter boundary and is
normalized before it reaches orchestrator evidence.

The internal installed-user rehearsal remains a black-box caller of public AOR
commands. Its contract loader composes a versioned, content-hashed snapshot of
the public contract kernel with internal-only families. Public families retain
their source identity, and any public kernel drift fails the parity gate until
the snapshot version and hashes are intentionally regenerated.

`executeFullJourneyFlow` and `writeProofRunnerArtifacts` are stable bounded
orchestrator facades. Private stage implementation and artifact projection stay
behind those facades and cannot be imported by production packages.

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

For internal full-journey installed-user rehearsal, the same loop must also leave behind:
- a feature-linked review verdict;
- a learning-loop scorecard;
- a learning-loop handoff that points backlog follow-up back to the curated mission and target repo;
- matrix-cell traceability for scenario family, provider variant, and declared feature size.

Learning handoff aggregates evidence refs and next actions. It may recommend backlog, eval, incident, or asset-recertification follow-up, but it does not replace feature review, Runtime Harness diagnosis, or asset certification decisions.
