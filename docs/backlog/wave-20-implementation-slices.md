# W20 implementation slices

## Wave objective
Close the production and platform maturity gaps that remain after the W19 story-traceability and product-quality backlog wave.

## Wave exit criteria
- W20 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- multirepo coordination, production security, provider certification, compiler revision lifecycle, and finance monitoring gaps have explicit acceptance evidence paths
- OpenCode remains blocked unless a stable live runtime can produce contract-valid certification evidence

## Sequencing notes
- `W20-S01`, `W20-S02`, `W20-S04`, and `W20-S05` can proceed after W19 story evidence stabilizes and their earlier foundation slices remain done.
- `W20-S03` has an external runtime blocker in addition to hard dependencies because OpenCode live-baseline certification cannot be claimed from mock or documentation-only evidence.

---

## W20-S01 — Multirepo scoped locks and cross-repo validation
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** Add a follow-up slice for scoped multirepo locks, cross-repo validation, and coordinated delivery safety.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, `apps/api`, `docs/ops/**`
- **Hard dependencies:** W19-S01, W8-S07
- **Primary user-story surfaces:** repository / multirepo owner, delivery transaction / Git / PR flow, security / compliance

### Local tasks
1. Define scoped lock ownership, duration, conflict, and release evidence.
2. Extend multirepo validation docs and examples before runtime behavior depends on new fields.
3. Add CLI/API read surfaces for lock and cross-repo validation status.
4. Add tests for conflict, stale lock, and partial validation scenarios.
5. Keep no-write and public-repo safety defaults explicit.

### Acceptance criteria
1. Multirepo work can declare and inspect scoped locks before coordinated delivery.
2. Cross-repo validation reports identify missing or failed repo checks.
3. Lock conflicts and stale locks fail with deterministic, auditable reasons.
4. Delivery manifests can reference the validation and lock evidence chain.

### Done evidence
- scoped lock and cross-repo validation docs/contracts
- CLI/API/runtime tests for lock and validation behavior
- updated multirepo delivery runbook evidence

### Out of scope
- unbounded organization-wide locking
- upstream repository writes by default
- replacing Git provider permissions with AOR lock state

---

## W20-S02 — Production security and observability hardening baseline
- **Epic:** EPIC-6 Operator surface
- **State:** blocked
- **Outcome:** Add a production-hardening follow-up slice for transport auth, authorization, redaction, logging, and operator observability boundaries.
- **Primary modules:** `docs/contracts/**`, `docs/architecture/**`, `apps/api`, `apps/web`, `apps/cli`, `packages/observability`
- **Hard dependencies:** W19-S01, W10-S04
- **Primary user-story surfaces:** security / compliance, operator / SRE, delivery engineer

### Local tasks
1. Define the production-hardening boundary separately from local trusted execution.
2. Extend auth, authorization, redaction, and audit docs before runtime changes.
3. Add tests for secret-safe output, denied mutations, and operator event redaction.
4. Preserve headless-first operation and detachable web semantics.
5. Update README status language if the production-hardening boundary changes.

### Acceptance criteria
1. Production-mode transport behavior has explicit auth and authorization checks.
2. Logs, events, CLI output, and API payloads avoid leaking configured secrets.
3. Denied actions preserve auditable reasons without exposing sensitive values.
4. Tests cover local trusted mode and production-hardened mode separately.

### Done evidence
- production hardening docs and contracts
- auth/redaction/observability tests
- updated operator docs and README status notes

### Out of scope
- enterprise identity-provider integration
- hosted SaaS deployment
- billing or tenant analytics

---

## W20-S03 — OpenCode live-baseline certification
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Promote OpenCode from extended/non-live-baseline coverage to a certified live baseline only after stable non-interactive runtime evidence exists.
- **Primary modules:** `examples/adapters/**`, `packages/adapter-sdk`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`
- **Hard dependencies:** W16-S06, W20-S02
- **External blocker:** Stable installed OpenCode runtime with non-interactive execution, usable permissions, and contract-valid live output for certification evidence.
- **Primary user-story surfaces:** delivery engineer, AI platform owner, operator / SRE

### Local tasks
1. Define OpenCode live-baseline certification criteria and required evidence.
2. Add or update adapter metadata only after permission semantics are live-runnable.
3. Run certification through the same contract and harness paths as other live baselines.
4. Update provider docs to distinguish candidate, extended, and certified statuses.
5. Keep mock-only evidence from promoting OpenCode to baseline.

### Acceptance criteria
1. OpenCode certification evidence comes from a stable live runtime, not deterministic mocks.
2. Adapter capability metadata records permission-policy behavior through contract-valid fields.
3. Harness/certification reports show pass decisions for required baseline scenarios.
4. Docs no longer describe OpenCode as extended-only after certification succeeds.

### Done evidence
- live OpenCode certification report
- updated adapter metadata and contract examples
- provider maturity docs reflecting certified baseline status

### Out of scope
- certifying OpenCode without live runtime evidence
- weakening permission-policy validation

---

## W20-S04 — Compiler revision asset lifecycle
- **Epic:** EPIC-4 Quality platform
- **State:** blocked
- **Outcome:** Add compiler revisions as a first-class platform asset with certification, promotion, freeze, and audit evidence.
- **Primary modules:** `docs/contracts/**`, `packages/harness`, `packages/orchestrator-core`, `apps/cli`, `apps/api`
- **Hard dependencies:** W19-S01, W8-S09
- **Primary user-story surfaces:** architect / tech lead, AI platform owner, incident / improvement owner

### Local tasks
1. Define compiler revision identity, provenance, compatibility, and lifecycle states.
2. Add certification and promotion evidence requirements for compiler revisions.
3. Link compiler revisions to compiled-context, incident, and evaluation evidence.
4. Add CLI/API surfaces for revision status and decision history.
5. Add tests for promote, freeze, demote, and incident correlation paths.

### Acceptance criteria
1. Compiler revisions are represented as first-class assets rather than implicit runtime details.
2. Certification decisions can promote or freeze compiler revisions with durable evidence.
3. Incident and evaluation outputs can reference the compiler revision involved.
4. CLI/API tests cover revision lifecycle and decision history reads.

### Done evidence
- compiler revision contract and lifecycle docs
- promotion/freeze tests and examples
- updated context asset and incident evidence links

### Out of scope
- changing compiled-context output semantics without migration notes
- provider-specific compiler behavior in orchestrator core
- OpenCode certification

---

## W20-S05 — Finance analytics and production monitoring loop
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Add a follow-up slice for finance analytics, tenant-like reporting boundaries, and the distinction between offline certification and production monitoring.
- **Primary modules:** `docs/contracts/**`, `packages/observability`, `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**`
- **Hard dependencies:** W20-S02, W7-S04
- **Primary user-story surfaces:** finance / audit / hygiene, operator / SRE, AI platform owner

### Local tasks
1. Define cost, latency, tenant-like grouping, and production-monitoring evidence boundaries.
2. Add read projections for finance trend and monitoring-loop signals.
3. Keep offline certification evidence separate from production monitoring evidence.
4. Add CLI/API/web tests for empty, partial, and populated analytics data.
5. Update finance/audit docs and story coverage evidence.

### Acceptance criteria
1. Finance analytics can summarize cost and latency by route, bundle, compiler revision, adapter, and project.
2. Production monitoring evidence is distinguishable from offline certification and rehearsal evidence.
3. Missing or partial telemetry returns explicit no-data or partial-data states.
4. CLI/API/web surfaces agree on field names and aggregation semantics.

### Done evidence
- finance analytics contract or projection docs
- CLI/API/web tests for finance and monitoring reads
- updated audit and operator runbook evidence

### Out of scope
- external billing-provider integration
- production SaaS tenancy
- changing certification pass/fail criteria
