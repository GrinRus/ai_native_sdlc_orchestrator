# W8 implementation slices

## Wave objective
Close later-maturity user stories for strategic operator visibility, governance hardening, context lifecycle maturity, and multi-repo delivery maturity.

## Wave exit criteria
- sponsor/planner visibility stories are supported by durable operator surfaces
- later discovery/architecture/security maturity stories are implemented with explicit contracts and policies
- later QA and AI platform comparison stories are executable and auditable
- routed execution produces deterministic compiled-context artifacts with adapter-ready context injection
- context assets are versioned, policy-gated, and promotion-auditable through AOR-owned lifecycle controls
- incident and platform recertification maturity is integrated with learning-loop evidence
- multi-repo and rerun maturity flows are bounded, reproducible, and policy-safe

## Parallel start and sequencing notes
- `W8-S01` and `W8-S02` can progress in parallel once `W7-S05` exists.
- `W8-S08` should land before `W8-S03` and `W8-S04` so later route/policy and operator visibility flows consume compiled-context outputs.
- `W8-S03` and `W8-S04` can run in parallel once `W8-S08` is available.
- `W8-S09` starts after `W8-S08` and `W8-S05` to reuse compiled-context artifacts and quality comparison semantics.
- `W8-S07` closes the wave after operator and incident maturity slices (`W8-S04`, `W8-S06`) are complete.

---

## W8-S01 — Sponsor and planner strategic visibility expansion
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Add strategic run and risk visibility surfaces for sponsor/manager later-stage planning stories.
- **Primary modules:** `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**`
- **Hard dependencies:** W7-S05
- **Primary user-story surfaces:** product sponsor / owner, engineering manager / planner

### Local tasks
1. Expand operator read surfaces with strategic wave/risk snapshots.
2. Add sponsor/planner oriented CLI or web views backed by existing contracts.
3. Document operational use of strategic visibility surfaces.
4. Add smoke tests for strategic visibility retrieval.

### Acceptance criteria
1. Strategic visibility data is available through operator surfaces.
2. Sponsor/planner workflows can inspect wave/risk state without ad hoc file inspection.
3. Docs define expected interpretation and limits of these surfaces.
4. Smoke tests cover read paths and missing-data behavior.

### Done evidence
- API/web/CLI visibility fixtures
- updated sponsor/planner runbook guidance
- smoke tests for strategic visibility endpoints

### Out of scope
- custom BI dashboards
- organization-specific reporting integrations

---

## W8-S02 — Later discovery and architecture maturity pack
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** blocked
- **Outcome:** Close later discovery and architecture stories with stronger completeness and architecture-traceability checks.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/product/**`
- **Hard dependencies:** W6-S02, W7-S05
- **Primary user-story surfaces:** discovery / research, architect / tech lead

### Local tasks
1. Extend discovery/spec command flows for later-stage completeness checks.
2. Add architecture-traceability linkage into generated planning artifacts.
3. Update docs and command semantics for later discovery/architecture workflows.
4. Add tests for new completeness and architecture-linking behavior.

### Acceptance criteria
1. Later discovery and architecture checks are executable through command surfaces.
2. Generated artifacts include explicit architecture-traceability data.
3. Docs and examples match runtime behavior.
4. Tests cover pass/fail completeness scenarios.

### Done evidence
- discovery/spec artifact fixtures with architecture links
- updated docs for later maturity discovery flow
- test coverage for completeness enforcement

### Out of scope
- automatic ADR authoring beyond bounded templates
- non-deterministic planner heuristics

---

## W8-S03 — Later delivery and security route-governance maturity
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Add later-stage route/policy governance required for delivery and security maturity stories.
- **Primary modules:** `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/policies/**`
- **Hard dependencies:** W6-S03, W7-S05, W8-S08
- **Primary user-story surfaces:** delivery engineer, security / compliance

### Local tasks
1. Add stronger route governance checks for high-risk delivery operations.
2. Extend policy resolution to expose explicit denial and escalation reasoning.
3. Align security docs with later-stage governance semantics.
4. Add tests for stricter allowlist/redaction/escalation paths.

### Acceptance criteria
1. Later-stage route governance checks are enforced before high-risk operations.
2. Policy outputs include explicit denial/escalation reasons.
3. Security/compliance docs and examples are aligned with runtime behavior.
4. Tests cover allow, deny, and escalation scenarios.

### Done evidence
- policy resolution fixtures with escalation reasons
- security governance test cases
- updated compliance runbook references

### Out of scope
- external IAM integration
- tenant-specific compliance overlays

---

## W8-S04 — Later operator event and policy visibility expansion
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Expand operator event and policy-inspection surfaces for later SRE maturity stories.
- **Primary modules:** `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**`
- **Hard dependencies:** W6-S03, W7-S05, W8-S08
- **Primary user-story surfaces:** operator / SRE

### Local tasks
1. Extend run/event visibility to include later-stage policy decision context.
2. Add operator query paths for route/policy history on selected runs.
3. Update ops docs for later-stage troubleshooting flow.
4. Add smoke tests for enriched event/policy visibility.

### Acceptance criteria
1. Operators can inspect enriched policy context from run/event surfaces.
2. Query paths support later-stage troubleshooting without raw log scraping.
3. Ops docs define expected troubleshooting sequence.
4. Smoke tests cover event history and policy-context retrieval.

### Done evidence
- API/web operator visibility fixtures
- updated troubleshooting runbook
- smoke tests for policy-aware event inspection

### Out of scope
- full observability platform migration
- external SIEM push integrations

---

## W8-S05 — Later QA and AI platform baseline comparison maturity
- **Epic:** EPIC-4 Quality platform
- **State:** ready
- **Outcome:** Close later QA and AI platform stories with stronger baseline comparison and regression triage coverage.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W7-S01, W7-S02
- **Primary user-story surfaces:** reviewer / QA, AI platform owner

### Local tasks
1. Expand suite comparison semantics for later-stage baseline governance.
2. Add richer regression triage metadata for QA and platform owners.
3. Update quality docs and examples to reflect the expanded comparison model.
4. Add tests for baseline drift, flaky handling, and controlled promotion outcomes.

### Acceptance criteria
1. Later-stage baseline comparisons are executable and auditable.
2. Regression triage metadata is present in quality artifacts.
3. Docs and examples align with comparison and triage runtime behavior.
4. Tests cover baseline drift and flaky-case handling paths.

### Done evidence
- expanded eval/comparison fixtures
- quality artifact examples with triage metadata
- automated tests for baseline and flaky workflows

### Out of scope
- proprietary judge-model orchestration
- autonomous release promotion

---

## W8-S06 — Later incident and platform recertification maturity
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Close later incident and AI platform recertification stories with integrated evidence and decision controls.
- **Primary modules:** `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W7-S03, W7-S04, W7-S05
- **Primary user-story surfaces:** incident / improvement owner, AI platform owner

### Local tasks
1. Extend incident recertification with platform-level freeze/demote linkage.
2. Ensure recertification decisions include finance and quality evidence references.
3. Update runbooks for integrated incident-platform recertification workflow.
4. Add tests for blocked, approved, and rollback recertification outcomes.

### Acceptance criteria
1. Incident and platform recertification decisions are linked and auditable.
2. Decisions reference finance and quality evidence roots consistently.
3. Ops docs define integrated recertification workflow and rollback behavior.
4. Tests cover all major recertification branches.

### Done evidence
- integrated incident/platform recertification fixtures
- updated learning-loop and incident runbook docs
- tests for decision branches and rollback paths

### Out of scope
- automatic route re-enable without approval
- non-local production rollout automation

---

## W8-S07 — Later multi-repo, bootstrap, and delivery rerun maturity
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Close later repository/multirepo/bootstrap/delivery rerun stories with bounded orchestration semantics.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S05, W6-S02, W8-S04, W8-S06
- **Primary user-story surfaces:** repository / multirepo owner, project bootstrap / onboarding, delivery transaction / Git / PR flow, finance / audit / hygiene

### Local tasks
1. Extend delivery rerun semantics for packet-boundary and failed-step recovery in later-stage flows.
2. Add multi-repo coordination metadata requirements to delivery/release preparation outputs.
3. Update bootstrap and delivery docs with later maturity constraints and evidence expectations.
4. Add tests for multi-repo bounded rerun and recovery-safe policy enforcement.

### Acceptance criteria
1. Later-stage rerun flows are bounded by packet/step semantics and auditable.
2. Multi-repo coordination evidence is present in delivery/release artifacts.
3. Bootstrap and delivery docs match implemented later-maturity behavior.
4. Tests cover rerun recovery, cross-repo coordination, and policy-blocked cases.

### Done evidence
- multi-repo delivery and rerun fixtures
- updated bootstrap/delivery runbooks for later maturity
- tests validating bounded rerun and coordination evidence

### Out of scope
- cross-org release automation
- external dependency management systems

---

## W8-S08 — Runtime context compiler and adapter-context injection
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Add deterministic step-time context compilation for prompt plus context assets and inject compiled context into adapter requests with durable evidence linkage.
- **Primary modules:** `packages/orchestrator-core`, `packages/provider-routing`, `packages/adapter-sdk`, `docs/contracts/**`, `examples/prompts/**`
- **Hard dependencies:** W6-S03, W7-S05
- **Primary user-story surfaces:** delivery engineer, reviewer / QA, security / compliance

### Local tasks
1. Switch runtime prompt source to `project-profile.default_prompt_bundles`.
2. Resolve and expand `default_context_bundles` as part of route/wrapper preparation.
3. Integrate a deterministic context compiler in routed execution for step-time assembly.
4. Inject compiled context into adapter request payloads (`request.context`) for execution.
5. Persist compiled-context artifacts and link them from step-result and evidence outputs.

### Acceptance criteria
1. Routed dry-run for `implement`, `review`, and `qa` emits a compiled-context artifact for each step.
2. Adapter requests include populated context payloads derived from compiled context.
3. Runtime and reference-integrity checks no longer require legacy `wrapper.prompt_bundle_ref` and `route.wrapper_profile_ref`.
4. Step-result and evidence outputs include stable references to compiled-context artifacts.

### Done evidence
- routed dry-run fixtures for `implement`, `review`, and `qa` with compiled-context outputs
- adapter request fixtures showing populated `request.context`
- updated reference-integrity and runtime checks aligned to compiled-context requirements
- step-result/evidence fixtures linking compiled-context artifact ids

### Out of scope
- provider-specific prompt-template syntax extensions
- external context registry runtime ownership

---

## W8-S09 — Context asset lifecycle and quality-gated update flow
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Add AOR-owned lifecycle operations for context assets with versioning, gated updates, and promotion decisions backed by eval evidence.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `apps/cli`, `apps/api`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W8-S08, W7-S02, W8-S05
- **Primary user-story surfaces:** reviewer / QA, AI platform owner, security / compliance, operator / SRE

### Local tasks
1. Add context quality scenarios comparing `with-context` versus `without-context` runs.
2. Add context update and outdated semantics with security gates for high/critical findings.
3. Add promotion and freeze policies specific to context assets and provenance.
4. Expose operator read surfaces for context status, version history, and decision trail.

### Acceptance criteria
1. Context updates are versioned, auditable, and linked to immutable provenance data.
2. Policy can block risky context updates before promotion.
3. Eval comparison evidence is required before context promotion decisions are accepted.
4. CLI and API surfaces expose context version, provenance, and decision history.

### Done evidence
- eval fixtures comparing `with-context` and `without-context` scenarios
- update/outdated decision fixtures with security-gate outcomes
- promotion/freeze policy fixtures for context assets
- API/CLI examples exposing context status and history views

### Out of scope
- mandatory publishing to external context marketplaces
- autonomous context promotion without operator approval
