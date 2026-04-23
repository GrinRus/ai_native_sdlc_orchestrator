# W10 implementation slices

## Wave objective
Reopen the roadmap after the baseline audit by turning the current live-execution, delivery, and transport baselines into externally exercised production-facing paths.

## Wave exit criteria
- the supported live adapter path invokes an external runner rather than returning an in-process deterministic success envelope
- fork-first delivery can perform bounded GitHub fork/branch/PR draft writes when approvals and credentials are present, while preserving safe planning-only fallbacks
- detached transport supports bounded authenticated mutation commands for connected operator clients
- at least one regression target and one release-shaped target from the catalog have fresh live evidence produced through the external runner and real bounded delivery paths

## Parallel start and sequencing notes
- `W10-S01`, `W10-S02`, and `W10-S03` can start in parallel because they close separate production-facing gaps on top of completed baselines.
- `W10-S04` starts after `W10-S03` so auth and permission work hardens an already-defined mutation surface rather than a hypothetical one.
- `W10-S05` starts after `W10-S01` and `W10-S02` so target-catalog proof uses real external execution and real bounded delivery rather than in-process or stubbed substitutes.

---

## W10-S01 — External live adapter execution baseline
- **Epic:** EPIC-3 Routed execution
- **State:** ready
- **Outcome:** Replace the current in-process deterministic `codex-cli` live path with a real external runner invocation path that preserves compiled-context, evidence, and guardrail semantics.
- **Primary modules:** `packages/adapter-sdk`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `examples/adapters/**`, `docs/ops/**`
- **Hard dependencies:** W9-S08
- **Primary user-story surfaces:** delivery engineer, AI platform owner, security / compliance

### Local tasks
1. Replace the deterministic live handler with an external runner invocation path behind explicit capability and policy gates.
2. Persist raw execution evidence and normalized adapter outputs without breaking compiled-context lineage.
3. Preserve dry-run/mock behavior and explicit blocked semantics for unsupported or risky routes.
4. Update adapter examples, runbooks, and tests for live success, blocked, and failed execution branches.

### Acceptance criteria
1. Supported live adapter execution launches an external runner path rather than returning a synthetic in-process success envelope.
2. Successful, blocked, and failed live executions preserve compiled-context and evidence lineage semantics.
3. Dry-run and mock paths still work without requiring external runner dependencies.
4. Tests and docs cover success, missing-prerequisite, and policy-blocked live branches.

### Done evidence
- external live adapter execution transcript or fixture
- tests covering live success, failure, and policy-blocked branches
- updated adapter profile and execution docs for the external runtime path

### Out of scope
- multi-provider rollout in one slice
- upstream delivery automation

---

## W10-S02 — Networked fork-first delivery execution
- **Epic:** EPIC-5 Delivery and release
- **State:** ready
- **Outcome:** Turn fork-first delivery from stubbed PR-intent planning into bounded networked fork, branch, and PR draft execution with safe fallbacks.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W4-S04, W6-S05
- **Primary user-story surfaces:** delivery engineer, security / compliance, delivery transaction / Git / PR flow

### Local tasks
1. Replace stubbed fork-first network intent with a real GitHub write path behind explicit approval and credential checks.
2. Preserve a planning-only fallback when credentials or approvals are not present.
3. Persist durable fork, branch, and PR identifiers plus blocked and recovery metadata.
4. Update delivery docs and tests for success, blocked, and retry paths.

### Acceptance criteria
1. Fork-first mode can create or verify fork, push branch, and prepare PR draft when required credentials and approvals are present.
2. Missing credentials or policy denials block safely without mutating upstream repositories.
3. Delivery manifests and transcripts capture real networked identifiers when writes happen and explicit planning-only metadata when they do not.
4. Docs and tests cover success, blocked, and recovery paths.

### Done evidence
- networked fork-first delivery transcript or fixture
- delivery-manifest and release-packet example with real fork and PR identifiers
- updated GitHub fork-first runbook and tests

### Out of scope
- auto-merge
- release publication to package registries

---

## W10-S03 — Detached transport mutation command baseline
- **Epic:** EPIC-6 Operator surface
- **State:** ready
- **Outcome:** Extend detached control-plane transport beyond GET-only reads so connected operator clients can invoke bounded run-control and UI lifecycle mutations over HTTP.
- **Primary modules:** `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W9-S07, W6-S03, W6-S04
- **Primary user-story surfaces:** operator / SRE, delivery engineer

### Local tasks
1. Add detached HTTP mutation endpoints for the supported run-control and UI lifecycle actions.
2. Keep HTTP and in-process command bindings aligned on shared contract and artifact semantics.
3. Switch connected web mode to use transport-backed mutations where configured.
4. Add transport smoke tests and docs for mutation parity and error handling.

### Acceptance criteria
1. Detached transport is no longer GET-only for the supported operator mutation baseline in this slice.
2. HTTP mutation paths emit the same durable audit and lifecycle artifacts as the in-process command path.
3. Headless and in-process workflows remain supported where still required.
4. Docs and tests cover supported mutation routes, error shapes, and connected-mode usage.

### Done evidence
- HTTP mutation smoke tests for run-control and UI lifecycle paths
- connected-mode web transcript or fixture using detached mutations
- updated control-plane transport docs for mutation parity

### Out of scope
- full CLI-over-HTTP parity
- transport authn or authz hardening

---

## W10-S04 — Detached transport authn/authz hardening baseline
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Add explicit operator identity and project-scoped permission enforcement to detached read and mutation transport before widening connected deployments.
- **Primary modules:** `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W10-S03
- **Primary user-story surfaces:** operator / SRE, security / compliance

### Local tasks
1. Define a minimal authn and project-scoped permission model for the supported detached transport surface.
2. Enforce read versus mutation authorization decisions consistently across supported endpoints.
3. Surface explicit `401` and `403` error shapes plus troubleshooting guidance.
4. Add tests and docs for authenticated success and unauthorized or forbidden failure branches.

### Acceptance criteria
1. Detached transport no longer assumes a permanently trusted local operator context when auth is enabled.
2. Supported read and mutation endpoints enforce project-scoped permissions consistently.
3. Error shapes and docs make auth failures diagnosable without raw log scraping.
4. Tests cover authenticated success, missing credentials, and insufficient-permission paths.

### Done evidence
- auth configuration example or fixture for detached transport
- transport auth tests for authenticated and rejected requests
- updated control-plane and operator runbooks for auth-enabled connected mode

### Out of scope
- enterprise SSO integration
- tenant-specific IAM overlays

---

## W10-S05 — Externally verified live E2E target-catalog proof
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Refresh live target-catalog evidence using external runner execution and real bounded delivery transactions instead of in-process or stubbed-only proofs.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/observability`, `docs/backlog/**`
- **Hard dependencies:** W10-S01, W10-S02
- **Primary user-story surfaces:** operator / SRE, delivery engineer, finance / audit / hygiene

### Local tasks
1. Run at least one regression target and one release-shaped target through the external live adapter and real bounded delivery path.
2. Capture fresh transcripts, scorecards, manifests, and incident or learning-loop evidence under `examples/live-e2e/fixtures/**`.
3. Update runbooks and dependency matrix entries with observed prerequisites, failure signatures, and safety defaults.
4. Link resulting evidence back to backlog closure criteria for production-facing readiness.

### Acceptance criteria
1. At least one regression target and one release-shaped target produce fresh external evidence from actual runner invocation.
2. Delivery evidence for the exercised path is no longer limited to stubbed fork-first metadata.
3. Runbooks and dependency matrix reflect observed external prerequisites, failure signatures, and safety defaults.
4. The evidence bundle is sufficient to review production-facing readiness without relying solely on narrative claims or fixture-only baselines.

### Done evidence
- fresh live-e2e transcripts and fixtures for selected targets
- updated scorecard, manifest, incident, and learning-loop artifacts linked to the same run ids
- updated runbooks and dependency matrix entries referencing the refreshed evidence bundle

### Out of scope
- broad target-catalog expansion
- upstream direct writes to public repositories
