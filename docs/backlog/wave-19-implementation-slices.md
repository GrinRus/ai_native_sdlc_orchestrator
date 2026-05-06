# W19 implementation slices

## Wave objective
Turn the user-story gap audit into executable backlog targets, starting with machine-checkable story coverage and then closing product, discovery, review, learning, and planning visibility gaps.

## Wave exit criteria
- W19 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- every supported user story has a stable ID, tier, coverage status, evidence pointer, and gap slice reference when applicable
- product intake, discovery research, review decisions, incident backfill, and planner metrics have bounded follow-up slices with explicit acceptance evidence

## Sequencing notes
- `W19-S01` starts first because later gap slices need stable story IDs and evidence references.
- `W19-S02` and `W19-S03` form the product-intake and discovery/research path.
- `W19-S04`, `W19-S05`, and `W19-S06` can proceed after the story registry closes because they target independent quality and operator visibility gaps.

---

## W19-S01 — User-story registry and coverage evidence matrix
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Promote the supported user-story inventory into a machine-checkable 112-story coverage matrix with stable IDs, tiers, evidence pointers, coverage status, and backlog gap references.
- **Primary modules:** `docs/product/**`, `docs/backlog/**`, `scripts/test.mjs`
- **Hard dependencies:** W17-S01
- **Primary user-story surfaces:** all role clusters

### Local tasks
1. Add a flat product story coverage matrix for the current 112-story working set.
2. Link partially covered and uncovered story outcomes to explicit W19/W20/W21 gap slices.
3. Add repository checks for story count, unique IDs, valid tiers, valid coverage statuses, and valid gap slice references.
4. Update roadmap and README references so the current backlog horizon is W21.
5. Run slice status and root checks after the synchronized backlog update.

### Acceptance criteria
1. The story matrix contains exactly 112 unique story IDs across the 14 documented role clusters.
2. Every non-covered story row references at least one existing backlog slice.
3. `pnpm test` fails if the matrix count, tiers, coverage statuses, or gap references drift.
4. `pnpm slice:status` keeps earlier ready W18 work ahead of W19 while W19-S01 remains a ready gap-traceability slice.
5. `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check` pass.

### Done evidence
- synchronized W19/W20/W21 backlog entries across source-of-truth docs
- machine-checkable user-story coverage matrix
- passing repository checks for story registry integrity

### Out of scope
- closing the product, runtime, or production gaps referenced by the matrix
- adding external SaaS intake connectors

---

## W19-S02 — Product intake source and KPI/DoD model
- **Epic:** EPIC-2 Packet lifecycle
- **State:** done
- **Outcome:** Add a bounded product-intake follow-up slice for project goals, constraints, KPIs, Definition of Done, and local source-material references.
- **Primary modules:** `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`
- **Hard dependencies:** W19-S01, W13-S03
- **Primary user-story surfaces:** product sponsor / owner, project bootstrap / onboarding, delivery engineer

### Local tasks
1. Define the product-intake source model and minimum KPI/DoD fields in source-of-truth docs.
2. Update packet or intake contracts before runtime code depends on new fields.
3. Wire CLI/runtime materialization for local issue, PRD, RFC, note, and mail-like source references.
4. Add examples and validation coverage for missing or incomplete KPI/DoD input.
5. Keep unsupported external SaaS connector behavior explicit.

### Acceptance criteria
1. Product-intake artifacts preserve goals, constraints, KPIs, DoD, and source references.
2. Contract validation rejects malformed required fields and accepts local structured source references.
3. CLI output exposes the same evidence fields documented in product and contract docs.
4. Examples cover complete and incomplete product-intake inputs.

### Done evidence
- updated product and contract docs for intake source and KPI/DoD fields
- contract examples and validation tests
- CLI/runtime evidence for materialized intake source metadata

### Out of scope
- live Jira, GitHub Issues, Gmail, Outlook, or other SaaS ingestion
- production product analytics
- real code-changing live E2E proof

---

## W19-S03 — Discovery research and ADR evidence flow
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Add a follow-up slice for executable discovery research output that can produce ADR-ready evidence from repository facts, runtime context assets, and local research inputs.
- **Primary modules:** `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`
- **Hard dependencies:** W19-S02, W8-S02
- **Primary user-story surfaces:** discovery / research, architect / tech lead, product sponsor / owner

### Local tasks
1. Define the discovery research artifact shape and ADR-ready evidence requirements.
2. Align discovery/spec command docs with the new research evidence path.
3. Implement or extend runtime materialization for local research evidence and open questions.
4. Add validation and examples for ADR-ready and incomplete research outputs.
5. Update story coverage rows when executable evidence exists.

### Acceptance criteria
1. Discovery research output links repository facts, context assets, research inputs, open questions, and ADR-ready recommendations.
2. Deterministic validation distinguishes complete research evidence from missing evidence.
3. CLI/runtime output is traceable from discovery to spec handoff.
4. Examples demonstrate a passing and failing research evidence flow.

### Done evidence
- discovery research contract or artifact docs
- runtime and CLI evidence for ADR-ready output
- validation coverage for complete and incomplete research packets

### Out of scope
- autonomous web research
- external browser-backed citation collection
- delivery implementation changes

---

## W19-S04 — Incident-to-dataset backfill workflow
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Add a controlled workflow that turns incidents and learning-loop handoffs into reviewed dataset or suite backfill proposals.
- **Primary modules:** `docs/contracts/**`, `packages/harness`, `packages/observability`, `packages/orchestrator-core`, `apps/cli`
- **Hard dependencies:** W19-S01, W7-S03, W13-S05
- **Primary user-story surfaces:** incident / improvement owner, AI platform owner, reviewer / QA

### Local tasks
1. Define the incident backfill proposal artifact and review state vocabulary.
2. Link incidents, scorecards, route/context assets, wrappers, adapters, and compiler revisions to proposed dataset cases.
3. Add CLI/runtime materialization for proposal creation from learning-loop evidence.
4. Add validation coverage that prevents silent mutation of stable datasets.
5. Document the reviewer path for accepting or rejecting proposed backfills.

### Acceptance criteria
1. Incident evidence can produce a dataset or suite backfill proposal with traceable source artifacts.
2. Stable datasets are not mutated without an explicit reviewed proposal state.
3. Proposal validation rejects missing incident, asset, or suite references.
4. CLI/runtime evidence links the proposal back to incident and learning-loop outputs.

### Done evidence
- incident backfill proposal docs and examples
- validation and runtime tests for proposal creation
- updated incident/learning-loop runbook evidence

### Out of scope
- automatic mutation of stable datasets without review
- production incident ingestion from external monitoring systems
- provider-specific incident heuristics in orchestrator core

---

## W19-S05 — Review decision and approval workflow
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Add explicit review decisions beyond report-only review so operators can approve, hold, or request repair with durable evidence.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api`
- **Hard dependencies:** W19-S01, W13-S05, W14-S06
- **Primary user-story surfaces:** reviewer / QA, delivery engineer, operator / SRE

### Local tasks
1. Define the review decision artifact and allowed decision vocabulary.
2. Wire CLI/API surfaces for approve, hold, and request-repair decisions.
3. Preserve the relationship between review reports, Runtime Harness reports, delivery manifests, and learning-loop handoffs.
4. Add tests for decision persistence and invalid transition rejection.
5. Update review and operator docs with the decision gate.

### Acceptance criteria
1. Review decisions are durable artifacts rather than narrative-only report fields.
2. Delivery or release preparation can reference the current review decision state.
3. Invalid or missing review decisions block risky downstream actions where policy requires approval.
4. CLI/API tests cover approve, hold, and request-repair flows.

### Done evidence
- review decision contract and examples
- CLI/API/runtime tests for decision flows
- updated operator review docs

### Out of scope
- a full reviewer web application
- changing existing review verdict meanings without migration notes
- bypassing deterministic validation before review

---

## W19-S06 — Planner metrics and scheduler visibility
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Add planner/operator visibility for decomposition quality, clean-close rate, retry rate, repair rate, and blocker rate.
- **Primary modules:** `docs/contracts/**`, `packages/observability`, `apps/api`, `apps/web`, `apps/cli`
- **Hard dependencies:** W19-S01, W6-S03, W8-S01
- **Primary user-story surfaces:** engineering manager / planner, operator / SRE, product sponsor / owner

### Local tasks
1. Define metric names and source artifacts for planner visibility.
2. Add read projections for clean-close, retry, repair, and blocker rates.
3. Expose CLI/API output and web console fields without making the web UI mandatory.
4. Add tests for empty, partial, and populated metric histories.
5. Update product coverage evidence after planner metrics are queryable.

### Acceptance criteria
1. Metrics are derived from durable run, review, incident, and audit artifacts.
2. CLI/API/web surfaces agree on metric names and basic aggregation semantics.
3. Empty projects return explicit no-data states rather than misleading zero-success claims.
4. Tests cover at least one clean-close, retry, repair, and blocker scenario.

### Done evidence
- metric source documentation
- CLI/API/web read-surface evidence
- tests for planner metric projections

### Out of scope
- production SLO dashboards
- tenant billing analytics
- changing run-control scheduling behavior
