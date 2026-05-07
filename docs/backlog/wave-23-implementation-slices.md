# W23 implementation slices

## Wave objective
Harden contract-first validation, production API auth scopes, and CLI/API lifecycle boundaries before deeper runtime ownership changes.

## Wave exit criteria
- Nested contract validators fail closed for production-critical packets and reports.
- Production-hardened API auth requires explicit permissions.
- CLI and API lifecycle behavior share a service boundary without app-to-app implementation cycles.

## Sequencing notes
- `W23-S01` depends on the W22 story-status repair because stricter contracts must close partial evidence rows, not blanket covered rows.
- `W23-S02` and `W23-S03` depend on the production-readiness source of truth so production auth and lifecycle boundaries target the same release mode.

---

## W23-S01 — Nested contract validation pack
- **Epic:** EPIC-4 Quality platform
- **State:** ready
- **Outcome:** Add canonical nested examples and loader validation for packet/report/event shapes that production gates depend on.
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`, `examples/**`, `scripts/reference-integrity.mjs`
- **Hard dependencies:** W22-S01
- **Primary user-story surfaces:** contract-first, validation-before-evaluation, review, incident, learning, and runtime evidence stories

### Local tasks
1. Add canonical examples for nested `step-result`, `validation-report`, `review-report`, `live-run-event`, `artifact-packet`, `incident-report`, `learning-loop-scorecard`, and `learning-loop-handoff` shapes.
2. Extend deterministic contract loader validation to reject invalid nested report and packet structures.
3. Add invalid-shape tests that prove nested validators fail closed.
4. Keep existing examples passing reference integrity after the stricter validation lands.

### Acceptance criteria
1. Invalid nested shapes fail loader tests deterministically.
2. Existing examples still pass reference integrity.
3. The contract index and loader coverage docs remain aligned with implemented validators.

### Done evidence
- nested contract examples
- contract loader tests for valid and invalid nested shapes
- passing reference integrity checks

### Out of scope
- runtime behavior changes outside contract validation
- judge/eval scoring changes

---

## W23-S02 — Explicit production auth scopes
- **Epic:** EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Make production-hardened API authorization fail closed for bearer tokens that do not declare explicit permissions while preserving local trusted behavior.
- **Primary modules:** `apps/api/**`, `apps/cli/**`, `packages/observability/**`, `docs/contracts/control-plane-api.md`, tests
- **Hard dependencies:** W22-S02
- **Primary user-story surfaces:** SEC-02, SEC-06, OPS-04, DEV-10

### Local tasks
1. Define explicit production permission semantics for read and mutate surfaces.
2. Reject missing or empty permission arrays in `production-hardened` mode.
3. Keep `local-trusted` compatibility for local development and existing smoke paths.
4. Ensure denial payloads and logs are redacted consistently across HTTP, SSE, CLI, and live logs.

### Acceptance criteria
1. API tests cover missing permissions, read-only, mutate-only, read+mutate, wrong-project, and redacted denial paths.
2. `local-trusted` tests remain compatible.
3. Production-hardened mutation denial never leaks token material or raw secrets.

### Done evidence
- auth scope tests for production-hardened and local-trusted modes
- updated control-plane auth docs
- redaction test coverage for denial paths

### Out of scope
- enterprise identity integration
- hosted SaaS tenant management

---

## W23-S03 — Shared lifecycle service boundary
- **Epic:** EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Remove API-to-CLI and CLI-to-API implementation coupling by extracting lifecycle command behavior into a shared application/service layer.
- **Primary modules:** `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, tests, dependency checks
- **Hard dependencies:** W22-S02
- **Primary user-story surfaces:** headless-first operator, lifecycle command, and API boundary stories

### Local tasks
1. Map current CLI/API lifecycle command sharing and dependency edges.
2. Extract shared lifecycle behavior into a package-level service owned outside app transports.
3. Update CLI and API handlers to call the shared service while preserving public output shapes.
4. Add dependency checks that fail on `apps/api -> apps/cli` or `apps/cli -> apps/api` source edges.

### Acceptance criteria
1. Dependency scan has no API-to-CLI or CLI-to-API implementation source edge.
2. Public CLI and API output shapes are preserved unless contract updates explicitly cover a change.
3. Lifecycle behavior tests run through both CLI and API entrypoints.

### Done evidence
- dependency scan output
- CLI/API lifecycle smoke tests
- shared service module references

### Out of scope
- redesigning command vocabulary
- making web own lifecycle orchestration
