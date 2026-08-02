# W18 implementation slices

## Wave objective
Close the connected web full-flow and topology proof gaps while preserving the headless-first control-plane model. W18 prioritizes interactive runner continuation first, then web lifecycle mutations, then full-flow web operation, with monorepo and bounded multirepo proof tracked as an independently ready delivery slice.

## Wave exit criteria
- W18 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- Runner-requested questions can be surfaced, answered, audited, and resumed or blocked through control-plane-owned semantics.
- Connected web has a backlog path for driving the approved lifecycle through command mutations without owning orchestration logic.
- The detachable web console backlog path includes full-flow step progression, answer submission, live events, and runner log visibility.
- One AOR project profile can be proven against both monorepo and bounded multirepo topologies with repo graph, validation, coordination, and delivery lineage evidence.

## Sequencing notes
- `W18-S01` is the P0 contract slice because `requested_interaction` must stop being a terminal-only signal before web can support runner questions.
- `W18-S02` depends on `W18-S01` so connected lifecycle mutations can carry interaction-continuation semantics from the start.
- `W18-S03` depends on `W18-S02` because web should call the control-plane mutation surface rather than owning orchestration logic.
- `W18-S04` is ready independently because existing multirepo foundations are done; the remaining gap is proof coverage and source-of-truth clarity.
- Real code-changing full-journey proof remains outside W18 scope.

---

## W18-S01 — Interactive run continuation contract
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Define contract and API behavior for surfacing runner questions, submitting operator answers, auditing the answer, and continuing or blocking the run without UI-owned orchestration.
- **Primary modules:** `docs/contracts/**`, `docs/architecture/**`, `docs/product/**`, `docs/backlog/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, delivery engineer, engineering manager / planner, security / compliance

### Local tasks
1. Update `control-plane-api`, `step-result`, and `live-run-event` contract docs with interactive continuation semantics.
2. Define the minimum answer-submission and audit behavior needed by CLI/API/web surfaces without adding UI-owned orchestration.
3. Update product and architecture docs so runner questions are represented as resumable operator interactions.
4. Add or update contract examples/coverage notes if the interface shape becomes machine-checkable in this slice.
5. Add targeted tests for contract loading or reference integrity when examples change.

### Acceptance criteria
1. `requested_interaction` is documented as an auditable continuation state, not only a terminal block signal.
2. Control-plane docs describe how operator answers are submitted and linked to run evidence.
3. Live event guidance explains how interactive prompts and answered/resumed states stay query-safe for CLI/web subscribers.
4. Product docs preserve headless-first operation and explicitly reject UI-owned orchestration.
5. Contract/reference checks pass for any changed examples or loader-covered docs.

### Done evidence
- updated control-plane, step-result, and live-run-event contract docs
- updated product or architecture wording for interactive continuation
- passing targeted contract/reference checks

### Out of scope
- implementing the web answer form
- implementing full lifecycle connected mutations
- changing runner adapter prompting behavior beyond the contract target

---

## W18-S02 — Full lifecycle command mutations for connected web
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Expose the minimum control-plane mutation surface needed for connected web to drive bootstrap, intake, discovery, spec, planning, handoff, run, review, delivery, and learning paths using existing runtime ownership.
- **Primary modules:** `apps/api`, `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W18-S01
- **Primary user-story surfaces:** product sponsor / owner, engineering manager / planner, delivery engineer, operator / SRE

### Local tasks
1. Extend the control-plane mutation contract from run-control/UI-lifecycle only to a bounded lifecycle command set.
2. Wire API mutation handlers to existing command/runtime operations rather than duplicating orchestration logic.
3. Preserve existing command output fields, artifact refs, guardrail decisions, and audit records in mutation responses.
4. Add connected transport tests for success, validation failure, policy block, and interactive-continuation branches.
5. Update ops docs with local trusted and auth-enabled connected mutation usage.

### Acceptance criteria
1. Connected web clients can invoke the minimum lifecycle command set through the control plane.
2. Runtime command modules remain the source of orchestration behavior and artifact materialization.
3. Blocked and interactive branches return durable evidence refs and stable error shapes.
4. CLI/headless paths continue to work without a connected web UI.
5. API and command tests cover the new mutation parity surface.

### Done evidence
- control-plane mutation contract update
- API/CLI/runtime tests for lifecycle command mutations
- updated connected-mode ops guidance

### Out of scope
- production multi-tenant workflow management
- replacing public CLI command ownership
- implementing the full web UI experience

---

## W18-S03 — Web full-flow operator console
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Implement the detachable web path for the full approved lifecycle, including answer submission, live runner logs/events, and step evidence navigation.
- **Primary modules:** `apps/web`, `apps/api`, `docs/ops/**`, tests
- **Hard dependencies:** W18-S02
- **Primary user-story surfaces:** product sponsor / owner, delivery engineer, reviewer / QA, operator / SRE

### Local tasks
1. Add web views/actions for the approved lifecycle stages using connected control-plane mutations.
2. Add an interaction panel that surfaces runner questions and submits operator answers through the W18-S02 API path.
3. Keep live events, runner logs, policy history, step results, and artifact links visible during the flow.
4. Add disconnected/headless-safe fallbacks that preserve read-only inspection when mutation transport is unavailable.
5. Add app smoke tests and fixtures for full-flow progress, question answer, blocked state, and detach behavior.

### Acceptance criteria
1. The web console can drive the lifecycle through control-plane calls rather than local UI orchestration.
2. Runner questions are visible, answerable, and linked back to run evidence from the UI.
3. Live event/log views remain available during long-running and blocked steps.
4. Detaching the web UI does not stop or mutate the underlying run unexpectedly.
5. Web/API tests cover connected success, blocked interaction, reconnect, and detach paths.

### Done evidence
- web full-flow smoke transcript or fixture
- tests for interaction answer submission and live evidence visibility
- updated UI attach/detach or operator console runbook

### Out of scope
- making web mandatory for runtime operation
- production-grade visual redesign
- multi-tenant deployment hardening

---

## W18-S04 — Monorepo and bounded multirepo flow proof
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Add examples and tests proving one AOR project profile can cover both a monorepo and a bounded multirepo setup such as backend services repo, mobile repo, and frontend repo.
- **Primary modules:** `examples/**`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/product/**`, `docs/ops/**`, tests
- **Hard dependencies:** none
- **Primary user-story surfaces:** repository / multirepo owner, delivery transaction / Git / PR flow, architect / tech lead, finance / audit / hygiene

### Local tasks
1. Add a bounded multirepo project-profile example with explicit backend, mobile, and frontend repos plus dependency edges.
2. Extend analysis/validation proof coverage for monorepo and bounded multirepo project profiles.
3. Add or refresh handoff, delivery-plan, delivery-manifest, and release evidence fixtures for impacted repo scope and coordination evidence.
4. Add tests for per-repo validation evidence, integration-level validation refs, coordination blocking, and delivery lineage.
5. Update product/architecture/ops docs to distinguish bounded multirepo from unsupported multi-`project_id` portfolio orchestration.

### Acceptance criteria
1. Monorepo and bounded multirepo examples load through the same project-profile contract path.
2. Bounded multirepo proof includes repo graph, impacted repo scope, per-repo validation evidence, and integration validation refs.
3. Non-`no-write` multirepo delivery remains blocked without coordination evidence.
4. Delivery manifest and release lineage preserve repo-level changed paths and coordination refs.
5. Product docs explicitly support single-repo, monorepo, and bounded multirepo while keeping multi-`project_id` portfolio orchestration out of MVP scope.

### Done evidence
- monorepo and bounded multirepo example profiles/fixtures
- targeted CLI/core tests for topology proof and delivery lineage
- updated product, architecture, contract, and ops docs

### Out of scope
- unbounded organization-wide portfolio optimization
- orchestration across multiple independent AOR `project_id`s
- direct upstream writes without existing delivery guardrails
