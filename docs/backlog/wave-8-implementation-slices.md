# W8 implementation slices

## Wave objective
Rebuild later-maturity operator, delivery, and multi-repo flows on top of compiled-context foundations.

## Wave exit criteria
- operator surfaces expose selected prompt/context assets, compile hashes, dropped inputs, and policy reasoning
- later discovery, bootstrap, delivery, and security flows consume AOR-native runtime context rather than repository-local guidance files
- baseline comparison and platform recertification flows can compare context bundles, compiler revisions, and resolved docs/rules/skills
- multi-repo and rerun orchestration use repo-aware compiled-context scope with bounded artifacts and audit traces
- later-maturity visibility, delivery, and incident workflows stay aligned with the quality and lineage model introduced in W6-W7

## Parallel start and sequencing notes
- `W8-S01` and `W8-S02` can progress in parallel once `W7-S05` closes.
- `W8-S03` and `W8-S04` share the same compiled-context lineage base and can progress in parallel after W7 closure.
- `W8-S07` is the wave closer because multi-repo and rerun maturity depend on delivery, operator, and incident lineage surfaces.

---

## W8-S01 — Strategic operator visibility on compiled context
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Give sponsors and planners strategic visibility into selected context assets, compile lineage, dropped inputs, and policy posture.
- **Primary modules:** `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**`
- **Hard dependencies:** W7-S05
- **Primary user-story surfaces:** product sponsor / owner, engineering manager / planner

### Local tasks
1. Extend operator read surfaces with strategic views of prompt/context selection and compile status by reading existing runtime artifacts rather than introducing parallel stores.
2. Add sponsor/planner-friendly summaries for blocked inputs, dropped context, and policy posture.
3. Update operational docs for interpreting strategic context-lineage signals.
4. Add smoke tests for strategic visibility retrieval.

### Acceptance criteria
1. Strategic operator surfaces expose prompt/context lineage without raw file inspection and without inventing hidden parallel state stores.
2. Sponsors and planners can see why a run used or dropped specific context assets.
3. Docs define the intent and limits of strategic compiled-context visibility.
4. Smoke tests cover happy-path and missing-data retrieval.

### Done evidence
- API/web/CLI fixtures for strategic context visibility
- runbook updates for sponsor/planner review
- smoke tests for strategic visibility

### Out of scope
- custom BI dashboards
- organization-specific reporting integrations

---

## W8-S02 — Discovery, spec, and bootstrap maturity on runtime context assets
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** blocked
- **Outcome:** Make later-stage discovery, specification, and bootstrap flows depend on AOR-native runtime context assets instead of repository-local guidance files.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/product/**`
- **Hard dependencies:** W6-S05, W7-S05
- **Primary user-story surfaces:** discovery / research, architect / tech lead, project bootstrap / onboarding

### Local tasks
1. Extend discovery/spec/bootstrap flows to resolve runtime context assets through project-profile references.
2. Add completeness checks for missing context coverage in discovery and planning artifacts.
3. Update product and contract docs so bootstrap recommendations point to AOR-native assets, not AGENTS files, and remove any AGENTS fallback semantics.
4. Add tests for discovery/spec/bootstrap behavior on the new runtime-context model.

### Acceptance criteria
1. Discovery, spec, and bootstrap flows select runtime context through project-profile and committed assets.
2. Generated artifacts expose missing-context readiness explicitly.
3. Docs and examples no longer recommend AGENTS-style runtime guidance or fallback behavior for these flows.
4. Tests cover complete and incomplete runtime-context coverage paths.

### Done evidence
- discovery/spec/bootstrap fixtures on runtime context assets
- updated product and contract docs for bootstrap maturity
- tests for context-coverage checks

### Out of scope
- automatic ADR authoring beyond bounded templates
- non-deterministic planner heuristics

---

## W8-S03 — Delivery and security context governance maturity
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Make delivery and security governance context-aware so high-risk operations depend on certified context/compiler state and explicit escalation reasons.
- **Primary modules:** `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S04, W7-S03, W7-S05
- **Primary user-story surfaces:** delivery engineer, security / compliance, finance / audit / hygiene

### Local tasks
1. Extend policy resolution with compiled-context-aware deny and escalation reasoning tied to certified context/compiler state.
2. Require certified context/compiler state before high-risk delivery operations proceed and persist explicit deny reasons when they do not.
3. Update security and delivery docs for context-aware governance behavior.
4. Add tests for allow, deny, and escalation outcomes driven by context lineage.

### Acceptance criteria
1. Policy outputs expose explicit deny and escalation reasons tied to prompt/context lineage and certified context/compiler state.
2. High-risk delivery is blocked when context assets or compiler state are uncertified.
3. Security and delivery docs align with the runtime governance behavior.
4. Tests cover allow, deny, escalation, and uncertified-state scenarios.

### Done evidence
- policy-resolution fixtures with context-aware escalation reasons
- delivery/security governance tests
- updated runbooks for context-aware delivery gating

### Out of scope
- external IAM integration
- tenant-specific compliance overlays

---

## W8-S04 — Event and history visibility for compiled context
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Extend run-event and history surfaces so operators can inspect context decisions, compile traces, and policy history without digging through raw artifacts.
- **Primary modules:** `apps/api`, `apps/web`, `apps/cli`, `packages/observability`, `docs/ops/**`
- **Hard dependencies:** W6-S04, W7-S05
- **Primary user-story surfaces:** operator / SRE, engineering manager / planner

### Local tasks
1. Extend run/event streams with compile hashes, selected assets, dropped inputs, and policy explanations by reading existing runtime artifacts rather than introducing parallel stores.
2. Add operator query paths for prompt/context history on selected runs from persisted lineage-aware artifacts.
3. Update troubleshooting runbooks for lineage-aware history inspection.
4. Add smoke tests for enriched event and history surfaces.

### Acceptance criteria
1. Operators can inspect compile traces and policy history from first-class surfaces backed by existing runtime artifacts.
2. Event and history queries remove the need for raw log scraping in common troubleshooting paths.
3. Runbooks describe the expected inspection sequence for compiled-context incidents.
4. Smoke tests cover event streaming and history retrieval with compile lineage.

### Done evidence
- API/web/CLI fixtures for event and history visibility
- troubleshooting runbook updates
- smoke tests for lineage-aware event/history retrieval

### Out of scope
- full observability platform migration
- external SIEM push integrations

---

## W8-S05 — Baseline comparison maturity for compiler and context revisions
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Compare compiler revisions and runtime context selections as first-class baseline subjects for QA and AI platform workflows.
- **Primary modules:** `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**`
- **Hard dependencies:** W7-S02, W7-S05
- **Primary user-story surfaces:** reviewer / QA, AI platform owner

### Local tasks
1. Extend baseline-comparison semantics to compare compiler revisions, resolved docs/rules/skills, and compiled outputs rather than only lifecycle IDs.
2. Add richer triage metadata for context-selection regressions and compile drift.
3. Update quality docs and examples to reflect the expanded baseline model.
4. Add tests for baseline drift, flaky handling, and controlled promotion outcomes.

### Acceptance criteria
1. Baseline comparisons can distinguish regressions caused by context or compiler changes at both resolved-asset and compiled-output layers.
2. Quality artifacts expose triage metadata for resolved docs/rules/skills, compile revisions, and compiled outputs.
3. Docs and examples align with the lineage-aware comparison model.
4. Tests cover drift, flake handling, and promotion-gated comparison outcomes.

### Done evidence
- expanded eval/comparison fixtures for context and compiler revisions
- quality examples with lineage-aware triage metadata
- automated tests for drift and flaky workflows

### Out of scope
- proprietary judge-model orchestration
- autonomous release promotion

---

## W8-S06 — Incident and platform recertification maturity with full lineage
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Close later incident and platform recertification stories with full route, prompt/context, compiler, and policy lineage.
- **Primary modules:** `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W7-S03, W7-S04, W7-S05
- **Primary user-story surfaces:** incident / improvement owner, AI platform owner, finance / audit / hygiene

### Local tasks
1. Extend recertification decisions with full lineage across route, wrapper, prompt/context, compiler, and policy.
2. Ensure incident workflows surface the evidence needed to re-enable or keep frozen problematic assets.
3. Update runbooks for integrated incident-platform recertification with full lineage.
4. Add tests for blocked, approved, and rollback recertification outcomes.

### Acceptance criteria
1. Recertification decisions carry full lineage across all runtime asset layers.
2. Incident workflows consistently reference the evidence needed for freeze, demote, and re-enable outcomes.
3. Ops docs define integrated recertification and rollback behavior on the full-lineage model.
4. Tests cover blocked, approved, demoted, and rollback paths.

### Done evidence
- integrated incident/platform recertification fixtures with full lineage
- updated incident and learning-loop runbooks
- tests for decision branches and rollback behavior

### Out of scope
- automatic route re-enable without approval
- non-local production rollout automation

---

## W8-S07 — Multi-repo and rerun maturity on compiled-context scope
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Make multi-repo delivery and rerun orchestration repo-aware at the compiled-context layer so bounded recovery works across coordinated repositories.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W6-S05, W8-S03, W8-S04, W8-S06
- **Primary user-story surfaces:** repository / multirepo owner, delivery transaction / Git / PR flow, project bootstrap / onboarding

### Local tasks
1. Extend rerun and recovery semantics with repo-aware compiled-context scope defined per participating repository.
2. Add multi-repo coordination metadata to delivery and release artifacts.
3. Update bootstrap and delivery docs with bounded rerun expectations on the new model.
4. Add tests for multi-repo compiled-context recovery and policy-safe reruns.

### Acceptance criteria
1. Multi-repo reruns are bounded by per-repo compiled-context scope and are auditable.
2. Delivery and release artifacts expose coordination metadata for participating repositories.
3. Bootstrap and delivery docs match the implemented rerun behavior.
4. Tests cover recovery, cross-repo coordination, and policy-blocked rerun cases.

### Done evidence
- multi-repo rerun fixtures with compiled-context scope
- updated bootstrap and delivery runbooks
- tests validating bounded rerun and coordination evidence

### Out of scope
- cross-org release automation
- external dependency management systems
