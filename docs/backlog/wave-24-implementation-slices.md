# W24 implementation slices

## Wave objective
Move from step-level harness strength to run-level Runtime Harness ownership for production-grade orchestration decisions.

## Wave exit criteria
- A run-level Runtime Harness controller owns run transitions and closure decisions.
- Interactive continuation has audited requested, answered, resumed, and blocked states.
- Strict code-changing delivery requires current run-level pass evidence and mission-scoped changes.

## Sequencing notes
- `W24-S01` depends on nested contract validation and the shared lifecycle service boundary.
- `W24-S02` depends on run-level controller ownership and production auth because answer handling crosses runtime and transport boundaries.
- `W24-S03` depends on run-level harness evidence and nested contract validation before strict delivery can trust reports.

---

## W24-S01 — Run-level Runtime Harness controller
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Add a run controller that owns run-level stage transitions and delegates individual routed steps to the existing step engine.
- **Primary modules:** `packages/orchestrator-core/**`, `packages/harness/**`, `packages/observability/**`, `apps/cli/**`, tests
- **Hard dependencies:** W23-S01, W23-S03
- **Primary user-story surfaces:** DEV-05, RQA-02, RQA-06, OPS-05, OPS-07

### Local tasks
1. Define run-level Runtime Harness report fields through contracts before runtime uses them.
2. Implement a controller for prepare, execute, classify, validate, retry, repair, escalate, verify, close, and block transitions.
3. Delegate individual routed step execution to the current step engine without provider leakage into core.
4. Record run-level decisions and evidence refs in durable reports.

### Acceptance criteria
1. Run-level tests prove pass, block, fail, repair, and exhausted-repair flows.
2. Step-level Runtime Harness reports remain compatible.
3. Provider-specific behavior stays outside orchestrator core.

### Done evidence
- run-level controller tests
- updated Runtime Harness report examples
- controller-generated reports in fixtures

### Out of scope
- replacing the step engine wholesale
- web-only orchestration ownership

---

## W24-S02 — Interactive continuation hardening
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Harden requested-interaction handling so requested, answered, resumed, and blocked states have audit refs and raw answers are not streamed.
- **Primary modules:** `docs/contracts/**`, `apps/cli/**`, `apps/api/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests
- **Hard dependencies:** W24-S01, W23-S02
- **Primary user-story surfaces:** EMP-03, OPS-04, DEV-05, SEC-02

### Local tasks
1. Extend requested-interaction evidence with requested, answered, resumed, and blocked states.
2. Persist answer audit refs without storing or streaming raw answer text through API/SSE/web.
3. Wire resume and block semantics through CLI, API, and optional web surfaces.
4. Add redaction and lifecycle tests for each continuation branch.

### Acceptance criteria
1. CLI, API, and web tests cover answer audit and resume/block semantics.
2. API/SSE/web never stream raw answer text.
3. Blocked interactions leave durable audit evidence and a deterministic next action.

### Done evidence
- requested-interaction contract examples
- CLI/API/web continuation tests
- redaction tests for answer payloads

### Out of scope
- chat-style hosted collaboration UI
- enterprise approval workflow integration

---

## W24-S03 — Strict delivery gate consolidation
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Consolidate strict delivery gates so code-changing delivery requires current run-level harness pass evidence and meaningful mission-scoped changed paths.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/cli/**`, `docs/contracts/**`, delivery tests
- **Hard dependencies:** W24-S01, W23-S01
- **Primary user-story surfaces:** PSO-05, DEV-05, DTX-01, DTX-02, DTX-03, DTX-04

### Local tasks
1. Define latest Runtime Harness report requirements for strict delivery.
2. Require routed decisions, `overall_decision=pass`, handoff/promotion evidence where applicable, and meaningful changed paths.
3. Reject no-op and out-of-scope changes before delivery manifests are materialized.
4. Cover patch-only, local-branch, fork-first-pr, and no-write safety behavior.

### Acceptance criteria
1. Delivery tests cover no-op, out-of-scope changes, missing harness report, missing handoff, missing promotion, and valid patch-only pass.
2. Strict delivery blocks before write-back when required evidence is absent.
3. Public-repo safety defaults remain no-upstream-write by default.

### Done evidence
- strict delivery gate tests
- updated delivery manifest/report examples
- delivery runbook updates

### Out of scope
- networked upstream writes by default
- bypassing review or deterministic validation gates
