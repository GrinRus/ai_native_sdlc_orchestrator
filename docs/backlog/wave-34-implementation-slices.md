# W34 - flow-centric console refactor and browser-task proof

Refactor the installed-user local console around runtime-owned flows while
preserving AOR's headless-first control-plane boundary and the hardened live E2E
skill-agent proof model.

## Wave objective

Turn the accepted flow-centric console design reference into implementable
contract, runtime, web, and proof slices:
- primary console object: a flow, not an isolated stage;
- active flows can progress through runtime-owned lifecycle mutations;
- completed flows remain read-only evidence chains;
- `New Flow` creates a fresh mission/intake packet and refreshed next-action
  evidence instead of mutating a completed flow;
- Ask AOR, evidence, trace, and interaction views are flow-scoped;
- live E2E validates the full flow loop through the current
  `installed-user-guided-journey.yaml` skill-agent path with browser-task proof
  evidence.

## Rebase alignment notes

The current `origin/main` live E2E baseline removed legacy bounded
`regress-short`, `regress-long`, `release-short`, `release-long`, and
`w7-governance-integration` proof profiles and deleted historical mock-backed
fixture bundles. W34 must not reintroduce those paths.

Frontend proof is now `live_e2e.frontend_capability=browser-task-proof`.
Deterministic web smoke remains a guardrail, but acceptance requires
frontend-interaction evidence such as HTML, DOM snapshot, accessibility summary,
screenshot or visual evidence, and an accepted skill-agent UI/UX verdict. The
proof path must preserve `final_skill_agent_verdict_request_file`,
`final_skill_agent_verdict_file`, and non-empty `inspected_evidence_refs[]`.

## Wave exit criteria

- W34 is represented across the roadmap, master backlog, epic map, dependency
  graph, and owning wave doc.
- Flow-centric product and contract docs define active/completed flow state,
  flow selection, new-flow creation, follow-up linkage, and read-only completed
  evidence without adding UI-owned orchestration state.
- Runtime/control-plane read models expose flow list, selected flow,
  flow-scoped evidence, and completed-flow read-only projections.
- The local React/Vite console implements the accepted design references under
  `docs/product/assets/w34-flow-centric-console/`.
- Ask AOR, Evidence Graph, Runtime Trace, Interactions Inbox, review, delivery,
  release, and learning closure views respect selected-flow boundaries.
- The installed-user guided proof validates first-flow closure, completed-flow
  read-only rendering, second-flow creation, flow-targeted operator requests,
  and no-upstream-write defaults through the current browser-task proof model.

---

## W34-S01 — Flow product and contract baseline
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Product, architecture, and contracts define a runtime-owned flow projection that can be implemented by CLI/API/web without inventing browser-only orchestration state.
- **Primary modules:** `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `examples/**`, `docs/backlog/**`
- **Hard dependencies:** W33-S10, W32-S01, W21-S07
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-11.

### Local tasks
1. Promote `docs/product/03-flow-centric-console-design.md` from design reference into the W34 product source-of-truth language.
2. Define active flow, completed flow, selected flow, follow-up source, and new-flow creation semantics in product and architecture docs.
3. Extend the control-plane contract docs with flow read projections and new-flow lifecycle semantics.
4. Add canonical example payloads for active flow, completed flow, flow list, and flow-targeted operator request summaries.
5. Keep the semantics additive over existing mission/intake, next-action, operator-request, review, delivery, release, and learning artifacts.

### Acceptance criteria
1. Flow state is explicitly runtime/control-plane-owned and not browser-owned.
2. Completed flows are documented as read-only evidence chains.
3. New flow creation is documented as a fresh mission/intake packet plus `next` refresh.
4. Follow-up flows can cite a learning handoff without mutating the completed source flow.
5. Contract examples include stable flow ids, evidence refs, status, selected stage, and write-back policy.

### Done evidence
- updated installed-user product journey
- updated flow-centric console design reference
- updated control-plane contract docs
- canonical flow projection examples
- backlog traceability to W34

### Out of scope
- Implementing runtime services or web UI.
- Adding UI-only packet fields.
- Making the web app mandatory.
- Hosted SaaS, SSO, CORS expansion, or upstream writes by default.

---

## W34-S02 — Runtime and control-plane flow projections
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** CLI/API/web can read selected-flow state, list active and completed flows, create a new flow through existing lifecycle commands, and keep completed evidence read-only.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `docs/contracts/**`, `examples/control-plane-api/**`, tests
- **Hard dependencies:** W34-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-11.

### Local tasks
1. Add a runtime flow projection service over mission/intake packets, next-action reports, run/review/delivery/release artifacts, and learning handoffs.
2. Add control-plane read routes for flow list, selected flow, and flow details without mutating state.
3. Route `New Flow` through existing lifecycle-command mutation behavior so it writes a fresh mission/intake packet and refreshes `next-action-report`.
4. Preserve completed-flow read-only behavior in CLI/API responses and lifecycle mutation guards.
5. Update OpenAPI and examples with bounded list/read payloads.
6. Add runtime, CLI, API, and contract tests for active/completed/new-flow paths.

### Acceptance criteria
1. Flow list returns active and completed flows with stable ids, status, mission refs, evidence refs, and latest next-action refs.
2. Selected-flow reads are deterministic and do not create artifacts.
3. Creating a new flow writes a new mission/intake artifact and does not overwrite completed-flow evidence.
4. Mutations against completed flows fail with an explicit blocked reason unless they are read-only inspections.
5. Existing headless CLI/API flows remain valid without launching web.

### Done evidence
- flow projection runtime service
- control-plane route and OpenAPI updates
- canonical API examples
- CLI/API/runtime/contract tests

### Out of scope
- Database or external search-index migration.
- Hosted multi-user flow collaboration.
- Replacing existing mission/intake or next-action contracts.

---

## W34-S03 — Flow-first local web shell
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The packaged local SPA implements the accepted flow-centric shell with project/runtime context, flow selector, active cockpit, stage rail, and safety/evidence right rail.
- **Primary modules:** `apps/web/**`, `apps/cli/**`, `docs/product/assets/w34-flow-centric-console/**`, tests
- **Hard dependencies:** W34-S02
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10.

### Local tasks
1. Rebuild the top bar around project identity, runtime root, selected flow, and `New Flow`.
2. Replace the stage-first main surface with an active-flow cockpit that shows one safe next action.
3. Keep the stage rail as flow-scoped navigation rather than lifecycle state ownership.
4. Render completed flows as read-only with disabled mutation controls and clear evidence-chain links.
5. Preserve responsive desktop/mobile layouts and stable dimensions for dense operator use.
6. Update web tests for connected, read-only, blocked, active, and completed states.

### Acceptance criteria
1. Active and completed flows are visually and behaviorally distinct.
2. `New Flow` is available from the flow selector without bypassing runtime lifecycle mutation.
3. The cockpit always shows next action, blockers, evidence refs, runtime root, write-back mode, and safety status.
4. Completed-flow mutation controls are disabled or replaced by read-only inspection actions.
5. The UI remains detachable and does not stop or own runs.

### Done evidence
- updated SPA components and CSS
- web source tests and app-smoke tests
- screenshots or browser-task proof artifacts linked from W34-S06

### Out of scope
- Static HTML snapshot renderer.
- UI-owned orchestration state.
- Hosted deployment or auth hardening.

---

## W34-S04 — Flow-scoped evidence, trace, and interaction workbench
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Advanced console views show evidence, runtime traces, operator requests, and runtime interactions in the selected-flow context.
- **Primary modules:** `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/contracts/**`, tests
- **Hard dependencies:** W34-S02
- **Primary user story surfaces:** OPS-02, OPS-03, OPS-11, DEV-06, DEV-07.

### Local tasks
1. Add flow-scoped Evidence Graph read/render behavior.
2. Add Runtime Trace view filtered by flow, run, step, and Runtime Harness evidence.
3. Update Ask AOR to require selected flow, target stage, intent, delivery mode, and target refs.
4. Keep runtime-requested interactions in the Interactions Inbox separate from operator-request work.
5. Ensure sanitized read payloads omit raw request text while preserving summaries and refs.
6. Add tests for cross-flow evidence isolation and target-flow request submission.

### Acceptance criteria
1. Evidence Graph never implies unrelated flow evidence belongs to the selected flow.
2. Runtime Trace links run events, step results, harness decisions, and delivery/release artifacts for the selected flow.
3. Operator requests preserve `target_flow_id`, target stage, delivery mode, allowed paths when required, and evidence refs.
4. Runtime-initiated interactions are answered through public control-plane surfaces and remain separate from Ask AOR.
5. Raw operator request text is not exposed through sanitized read routes.

### Done evidence
- updated web advanced views
- API/runtime flow-scoped read behavior
- operator-request target-flow tests
- sanitized read-route tests

### Out of scope
- Direct chat-style agent bypass.
- Silent source mutation from the UI.
- Cross-project flow aggregation.

---

## W34-S05 — Closure-to-new-flow UX
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Learning closure gives the operator an explicit, safe path to start a second flow while preserving the completed first flow as audit evidence.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/web/**`, `docs/product/**`, `docs/contracts/**`, tests
- **Hard dependencies:** W34-S02
- **Primary user story surfaces:** PSO-05, OPS-04, DTX-07, INC-06.

### Local tasks
1. Add closure-state projection fields for completed flow, follow-up eligibility, and source learning handoff refs.
2. Add `Start New Flow`, `Create follow-up from learning handoff`, and duplicate mission settings behavior through runtime-owned lifecycle commands.
3. Keep completed-flow evidence available from history without reopening it for mutation.
4. Ensure next-action resolution points operators toward new-flow creation after learning closure when appropriate.
5. Add tests for closure-to-new-flow guardrails and handoff linkage.

### Acceptance criteria
1. Learning closure exposes a clear next action for starting a new flow.
2. A follow-up flow records `follow_up_source_handoff_ref` or equivalent lineage.
3. Duplicated mission settings create new intake evidence rather than editing the old flow.
4. Completed-flow history remains inspectable after second-flow creation.
5. No upstream-write default is preserved across the transition.

### Done evidence
- closure projection updates
- web closure/new-flow controls
- next-action and lifecycle mutation tests

### Out of scope
- Automatic unsupervised follow-up execution.
- Editing completed learning handoff artifacts.
- Hosted collaboration workflows.

---

## W34-S06 — Installed-user browser-task flow-loop proof
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Live E2E proves the flow-centric console through the hardened installed-user guided journey with browser-task frontend evidence and accepted skill-agent verdicts.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `docs/ops/**`, `apps/web/**`, `apps/cli/**`, tests
- **Hard dependencies:** W34-S03, W34-S04, W34-S05
- **Primary user story surfaces:** OPS-06, OPS-07, PBO-09, OPS-11.

### Local tasks
1. Update `installed-user-guided-journey.yaml` to require flow-loop proof fields and preserve `live_e2e.frontend_capability=browser-task-proof`.
2. Extend guided proof generation with first-flow, completed-flow, second-flow, follow-up, and target-flow operator-request evidence.
3. Capture frontend interaction evidence: rendered HTML, DOM snapshot, accessibility summary, screenshot or visual guardrail evidence, task outcome, UX findings, and skill-agent UI/UX verdict refs.
4. Require `final_skill_agent_verdict_request_file`, `final_skill_agent_verdict_file`, accepted step decisions, and non-empty `inspected_evidence_refs[]`.
5. Update fixtures and tests without reintroducing deleted bounded profiles or mock-backed bundles.
6. Document the refreshed proof path in live E2E runbooks.

### Acceptance criteria
1. Proof records `first_flow_id`, `first_flow_status=completed`, `completed_flow_read_only=true`, `second_flow_id`, and `second_flow_id != first_flow_id`.
2. Proof records `follow_up_source_handoff_ref` when the second flow starts from learning closure.
3. Proof records `new_flow_mission_artifact_packet_file` and a refreshed next-action report for the second flow.
4. Proof records `operator_request.target_flow_id` for flow-targeted Ask AOR scenarios.
5. Frontend proof includes HTML, DOM, accessibility, screenshot or visual guardrail refs, task outcome, UX findings, and `agent_verdict_ref`.
6. Acceptance fails closed when skill-agent decisions, final verdict, inspected refs, browser-task evidence, or no-upstream-write assertions are missing.

### Done evidence
- updated installed-user guided profile
- guided proof schema/runtime updates
- refreshed W34 fixture samples
- live E2E runner and step-controller tests
- updated live E2E runbook sections

### Out of scope
- Reintroducing `regress-short`, `release-short`, or W7 governance bounded proof profiles.
- Treating deterministic app smoke alone as acceptance proof.
- Requiring upstream writes or remote PR creation.

---

## W34-S07 — Backlog, docs, and release-gate alignment
- **Epic:** EPIC-0 Repository development system
- **State:** blocked
- **Outcome:** The flow-centric console refactor is release-reviewable with aligned source-of-truth docs, smoke guidance, and root gates.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**`, `scripts/**`, release tests
- **Hard dependencies:** W34-S06
- **Primary user story surfaces:** source-of-truth alignment only; no new story closure.

### Local tasks
1. Update README and installed-user docs with the flow-centric console path.
2. Update ops runbooks to point at W34 browser-task guided proof evidence.
3. Update backlog, epic, dependency, and roadmap docs after implementation lands.
4. Refresh release smoke expectations for `aor app`, flow selector, and `New Flow`.
5. Run `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check`.

### Acceptance criteria
1. No docs imply the old stage-only console is the target W34 UX.
2. No docs cite removed bounded live E2E profiles as current proof paths.
3. Release smoke and live E2E docs agree on browser-task proof evidence.
4. Root gates pass or any intentional pending gate has a documented reason and follow-up.

### Done evidence
- README and ops updates
- backlog source-of-truth alignment
- release smoke updates
- root check output

### Out of scope
- New product behavior beyond documenting and validating W34.
- Production security, hosted deployment, SSO, or CORS expansion.
