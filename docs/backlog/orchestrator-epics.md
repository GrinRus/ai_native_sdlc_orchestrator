# Orchestrator epics

## EPIC-0 Repository development system
Turn the design package into a verifiable monorepo and contributor-safe development system.

**Slices by wave:**
- **W0:** `W0-S01` Workspace and package build baseline; `W0-S02` Contracts package and schema loader baseline; `W0-S03` Example and reference integrity checks; `W0-S04` Agent guidance and backlog workflow baseline; `W0-S06` Repository CI and acceptance gates
- **W6:** `W6-S01` Backlog and slice-cycle extensibility for W6+
- **W9:** `W9-S02` Current-state documentation drift repair
- **W11:** `W11-S01` Source-of-truth reality repair
- **W12:** `W12-S01` Public surface realignment
- **W13:** `W13-S01` Backlog-first full-journey internal installed-user rehearsal realignment
- **W14:** `W14-S01` Backlog and source-of-truth realignment
- **W15:** `W15-S01` Source-of-truth and readiness queue repair; `W15-S02` Package/module workspace alignment
- **W16:** `W16-S01` Complexity baseline and shared helper extraction
- **W17:** `W17-S01` Legacy surface cleanup after W16
- **W19:** `W19-S01` User-story registry and coverage evidence matrix
- **W22:** `W22-S01` Evidence-strength story coverage model; `W22-S02` Production readiness source-of-truth
- **W26:** `W26-S01` Production readiness gate; `W26-S02` Maintainability stabilization
- **W30:** `W30-S01` Post-W29 alpha-hardening planning source of truth; `W30-S02` Alpha architecture decision records; `W30-S05` Alpha readiness gate expansion
- **W33:** `W33-S01` Console flow source-of-truth and static snapshot removal; `W33-S02` Reliable root gates and internal installed-user rehearsal timeout bounds
- **W34:** `W34-S07` Backlog, docs, and release-gate alignment
- **W40:** `W40-S01` Post-alpha.7 backlog and product baseline
- **W41:** `W41-S01` Post-alpha.8 backlog and validation baseline; `W41-S04` Alpha.8 findings closure and next-release decision
- **W43:** `W43-S01` Post-alpha.10 backlog and confidence baseline; `W43-S04` Alpha.10 findings closure and next-release decision
- **W44:** `W44-S01` Artifact workflow taxonomy and transition invariants; `W44-S05` Post-implementation docs and internal installed-user rehearsal validation
- **W45:** `W45-S06` Documentation refresh and internal installed-user rehearsal acceptance
- **W46:** `W46-S01` Contract/docs breaking policy; `W46-S06` Proof-complete acceptance closure and findings intake
- **W47:** `W47-S04` Full proof rerun and product acceptance closure
- **W48:** `W48-S01` Quality-cycle contract and profile policy; `W48-S05` Control quality-cycle proof rerun and product acceptance closure (closed as W49/W50 successor-proof reconciliation, not W48-only product acceptance)
- **W49:** `W49-S01` Proof findings hygiene and evidence truthfulness; `W49-S04` Full Control internal installed-user rehearsal rerun and product acceptance closure
- **W50:** `W50-S03` Fastify/Vitest control rerun and product acceptance closure; `W50-S04` Findings/backlog state sync
- **W51:** `W51-S01` Clean-commit W50 proof rerun
- **W52:** `W52-S05` Hard-target proof rerun and findings sync; `W52-S10` Acceptance evidence matrix and xlarge observation reporting
- **W53:** `W53-S04` AOR/live E2E leak guards
- **W54:** `W54-S08` Boundary regression expansion
- **W55:** `W55-S01` Backlog intake and control finding disposition; `W55-S05` Control rerun and findings report
- **W57:** `W57-S01` Audit disposition, release hold, and local-app threat model; `W57-S09` Complete test discovery and deterministic safety-gate baseline; `W57-S08` Trust-boundary regression proof and release disposition
- **W58:** `W58-S06` Canonical API, OpenAPI, CLI, and service boundary; `W58-S08` Runtime-quality acceptance proof
- **W59:** `W59-S01` Executable browser and component behavior gate; `W59-S03` Accessible local dialogs and web state decomposition; `W59-S04` Code-quality, dependency, and dead-code ratchet; `W59-S05` Core, CLI, and control-plane decomposition; `W59-S06` Adapter/live-E2E decomposition and contract-kernel parity; `W59-S07` Independent audit closure and readiness decision

- **W60:** `W60-S01` Structured task contract and backlog detail baseline; `W60-S05` Structured planning proof and documentation closure
- **W61:** `W61-S05` Topology onboarding proof and documentation closure
- **W62:** `W62-S06` Monorepo and bounded multirepo full-flow proof
- **W63:** `W63-S01` Operator journey, action semantics, and scenario baseline; `W63-S02` Semantic design system and component contracts; `W63-S07` Installed-console UX/UI acceptance and story closure
- **W64:** `W64-S01` Idempotent alpha publish transaction and partial-failure recovery; `W64-S02` Verification-to-delivery transaction decomposition; `W64-S03` Operator decision projection decomposition
## EPIC-1 Bootstrap and onboarding
Create a repeatable flow to turn a repository into a machine-usable target.

**Slices by wave:**
- **W1:** `W1-S02` Project init and profile loading runtime; `W1-S03` Project analysis engine and durable analysis report; `W1-S05` Project verify flow and bounded preflight execution
- **W8:** `W8-S02` Later discovery and architecture maturity pack
- **W13:** `W13-S03` Public bootstrap and feature-intent intake
- **W19:** `W19-S03` Discovery research and ADR evidence flow
- **W21:** `W21-S01` Installed-user onboarding UX contract; `W21-S03` Clean project onboarding and asset-root resolution
- **W36:** `W36-S01` No-settings onboarding and workspace contract baseline
- **W40:** `W40-S02` Installed-user onboarding and release docs hardening
- **W41:** `W41-S02` Alpha.8 installed-user onboarding smoke refresh
- **W43:** `W43-S02` Alpha.10 installed-user onboarding and evidence smoke
- **W44:** `W44-S03` Artifact readiness state machine and stale transitions
- **W54:** `W54-S02` Stack discovery engine; `W54-S03` Project init profile materialization
- **W56:** `W56-S01` First-run console focus and action clarity; `W56-S02` Rendered cockpit UX hardening; `W56-S03` Rendered UX audit closure
- **W57:** `W57-S02` Canonical identifier, path, and mission-scope contracts; `W57-S03` True workspace isolation and no-write enforcement; `W57-S06` Transactional initialization and runtime-root containment
- **W58:** `W58-S01` Non-materializing read-model contract and runtime; `W58-S02` Effective context and unique asset identity
- **W59:** `W59-S02` Local console live-state and interaction correctness

- **W61:** `W61-S01` Project topology and local binding contract baseline; `W61-S02` Persistent local workspace registry and topology discovery; `W61-S03` Project topology CLI/API management and validation
- **W63:** `W63-S03` Guided Mission intake and resumable first-flow creation; `W63-S06` Attention queue, evidence workbench, and cockpit hierarchy
## EPIC-2 Packet lifecycle
Materialize discovery, planning, handoff, release, and adjacent artifacts as durable packets.

**Slices by wave:**
- **W1:** `W1-S06` Runtime store and artifact packet materialization; `W1-S07` Wave ticket and handoff packet foundation
- **W19:** `W19-S02` Product intake source and KPI/DoD model
- **W21:** `W21-S04` Guided mission intake and next-action resolver
- **W57:** `W57-S02` Canonical identifier, path, and mission-scope contracts; `W57-S06` Transactional initialization and runtime-root containment; `W57-S07` Atomic attempts, run control, and event identity

- **W60:** `W60-S01` Structured task contract and backlog detail baseline; `W60-S02` Planner decomposition and task quality gate; `W60-S03` Execution plan and evidence-derived task progress
- **W61:** `W61-S01` Project topology and local binding contract baseline
- **W62:** `W62-S02` Impact scope and execution DAG planning
- **W63:** `W63-S03` Guided Mission intake and resumable first-flow creation
## EPIC-3 Routed execution
Resolve and execute steps through routes, wrappers, prompt bundles, policies, and adapters.

**Slices by wave:**
- **W2:** `W2-S01` Route registry and step resolution kernel; `W2-S02` Wrapper, prompt-bundle, and asset loader runtime; `W2-S03` Step policy resolution, budgets, and guardrails; `W2-S04` Adapter SDK and mock adapter baseline; `W2-S05` Routed step execution engine and durable step results
- **W8:** `W8-S03` Later delivery and security route-governance maturity; `W8-S08` Runtime context compiler and adapter-context injection
- **W9:** `W9-S01` Run-scoped routed evidence durability bugfix; `W9-S08` First real provider adapter and live execution foundation
- **W10:** `W10-S01` External live adapter execution baseline
- **W11:** `W11-S03` Profile-driven preflight and routed live execution
- **W13:** `W13-S04` Feature-driven discovery and execution lifecycle
- **W16:** `W16-S04` Orchestrator-core execution decomposition; `W16-S06` Adapter permission legacy removal
- **W20:** `W20-S03` OpenCode candidate evidence and downgrade follow-up
- **W22:** `W22-S03` OpenCode maturity downgrade
- **W44:** `W44-S01` Artifact workflow taxonomy and transition invariants; `W44-S02` Discovery/research/spec prompt bundle split; `W44-S04` Context, skill, and policy overlays from evidence
- **W57:** `W57-S02` Canonical identifier, path, and mission-scope contracts; `W57-S03` True workspace isolation and no-write enforcement; `W57-S04` Structural runtime permission enforcement; `W57-S07` Atomic attempts, run control, and event identity
- **W58:** `W58-S02` Effective context and unique asset identity; `W58-S03` Executable route fallback, retry, repair, and adapter semantics; `W58-S05` Asynchronous run jobs and durable live-event delivery
- **W59:** `W59-S05` Core, CLI, and control-plane decomposition; `W59-S06` Adapter/live-E2E decomposition and contract-kernel parity

- **W60:** `W60-S02` Planner decomposition and task quality gate; `W60-S03` Execution plan and evidence-derived task progress
- **W62:** `W62-S01` Workspace-set provisioner and repository change evidence; `W62-S02` Impact scope and execution DAG planning; `W62-S03` Parent/child Runtime Harness scheduler and bounded concurrency
- **W63:** `W63-S04` Truthful action-first cockpit and recovery controls
## EPIC-4 Quality platform
Implement validation, eval, harness, certification, and promotion.

**Slices by wave:**
- **W1:** `W1-S04` Deterministic project validate flow
- **W3:** `W3-S01` Validation kernel generalization and asset graph checks; `W3-S02` Dataset and evaluation suite registry; `W3-S03` Eval runner and scorer interface; `W3-S04` Harness capture and replay runtime; `W3-S05` Certification and promotion decision baseline
- **W7:** `W7-S01` Governance quality guardrails and evidence parity; `W7-S02` AI platform promotion/freeze maturity pack
- **W8:** `W8-S05` Later QA and AI platform baseline comparison maturity; `W8-S09` Context asset lifecycle and quality-gated update flow
- **W9:** `W9-S05` Public harness replay command surface; `W9-S06` Asset promote/freeze command surface completion
- **W13:** `W13-S05` Public review and learning-loop closure surfaces
- **W14:** `W14-S06` Review, audit, and closure alignment
- **W19:** `W19-S04` Incident-to-dataset backfill workflow; `W19-S05` Review decision and approval workflow
- **W20:** `W20-S04` Compiler revision asset lifecycle
- **W21:** `W21-S06` Review, delivery, release, and learning closure UX
- **W23:** `W23-S01` Nested contract validation pack
- **W24:** `W24-S01` Run-level Runtime Harness controller
- **W44:** `W44-S04` Context, skill, and policy overlays from evidence
- **W45:** `W45-S01` Quality repair request contract and operating model; `W45-S02` Cross-stage repair state machine and next-action resolver
- **W47:** `W47-S03` AOR repair/review convergence hardening
- **W48:** `W48-S03` Structured repair context and convergence classification
- **W49:** `W49-S02` Repeated repair anti-loop enforcement; `W49-S03` QA-specific step-quality evaluator hardening
- **W50:** `W50-S01` Review verification mapping and residual-risk classification
- **W51:** `W51-S03` Automated final quality report hydration
- **W52:** `W52-S02` Diagnostic command hang and timeout hardening; `W52-S08` Manual step-quality assessment depth; `W52-S09` Diagnostic command classification precision
- **W53:** `W53-S01` Generic verification command-group contract; `W53-S02` AOR project verify command-group execution; `W53-S05` Generic verification archetype fixtures
- **W54:** `W54-S01` Verification group authoring contract; `W54-S02` Stack discovery engine; `W54-S04` Verifier execution semantics hardening; `W54-S06` Migration and examples; `W54-S07` Real archetype smoke matrix
- **W55:** `W55-S02` Actionable verification failure repair evidence
- **W57:** `W57-S05` Exact-diff delivery and resolvable authorization evidence
- **W58:** `W58-S02` Effective context and unique asset identity; `W58-S03` Executable route fallback, retry, repair, and adapter semantics; `W58-S04` Real evaluation, Harness lineage, and replay compatibility
- **W59:** `W59-S06` Adapter/live-E2E decomposition and contract-kernel parity

- **W60:** `W60-S01` Structured task contract and backlog detail baseline; `W60-S02` Planner decomposition and task quality gate
- **W62:** `W62-S02` Impact scope and execution DAG planning; `W62-S03` Parent/child Runtime Harness scheduler and bounded concurrency; `W62-S04` Integration, stale-task invalidation, and bounded repair
- **W63:** `W63-S04` Truthful action-first cockpit and recovery controls; `W63-S06` Attention queue, evidence workbench, and cockpit hierarchy
- **W64:** `W64-S03` Operator decision projection decomposition
## EPIC-5 Delivery and release
Support bounded delivery modes, manifests, and release evidence.

**Slices by wave:**
- **W4:** `W4-S01` Isolated worktree and workspace execution foundation; `W4-S02` Delivery planning and write-back mode policy; `W4-S03` Patch and local branch delivery driver; `W4-S04` Fork-first GitHub PR delivery driver; `W4-S05` Delivery manifest and release packet materialization
- **W6:** `W6-S05` Delivery/release prepare command pack
- **W8:** `W8-S07` Later multi-repo, bootstrap, and delivery rerun maturity
- **W10:** `W10-S02` Networked fork-first delivery execution
- **W11:** `W11-S04` Target-anchored delivery and release evidence
- **W18:** `W18-S04` Monorepo and bounded multirepo flow proof
- **W20:** `W20-S01` Multirepo scoped locks and cross-repo validation
- **W24:** `W24-S03` Strict delivery gate consolidation
- **W29:** `W29-S01` npm CLI alpha release channel
- **W30:** `W30-S06` Alpha release and onboarding proof refresh
- **W42:** `W42-S01` Alpha.9 release prep for W41 fixes
- **W57:** `W57-S02` Canonical identifier, path, and mission-scope contracts; `W57-S03` True workspace isolation and no-write enforcement; `W57-S05` Exact-diff delivery and resolvable authorization evidence
- **W59:** `W59-S07` Independent audit closure and readiness decision

- **W61:** `W61-S01` Project topology and local binding contract baseline
- **W62:** `W62-S01` Workspace-set provisioner and repository change evidence; `W62-S04` Integration, stale-task invalidation, and bounded repair; `W62-S05` Coordinated delivery and execution UX
- **W64:** `W64-S01` Idempotent alpha publish transaction and partial-failure recovery; `W64-S02` Verification-to-delivery transaction decomposition
## EPIC-6 Operator surface
Expose CLI, API, live events, and detachable UI flows.

**Slices by wave:**
- **W1:** `W1-S01` Bootstrap CLI shell and command contracts
- **W5:** `W5-S01` Control plane API read surface; `W5-S02` Live run event stream; `W5-S03` CLI operator commands beyond bootstrap; `W5-S04` Detachable web UI baseline
- **W6:** `W6-S02` Intake/discovery/spec/wave command pack; `W6-S03` Run-control command pack with policy and audit guardrails; `W6-S04` UI attach/detach lifecycle command pack
- **W8:** `W8-S01` Sponsor and planner strategic visibility expansion; `W8-S04` Later operator event and policy visibility expansion
- **W9:** `W9-S03` Control-plane API contract/runtime alignment; `W9-S04` Machine-checkable control-plane API contract coverage; `W9-S07` Detached HTTP control-plane transport baseline
- **W10:** `W10-S03` Detached transport mutation command baseline; `W10-S04` Detached transport authn/authz hardening baseline
- **W12:** `W12-S03` Breaking CLI and contract removal
- **W16:** `W16-S02` CLI dispatcher decomposition; `W16-S03` API and read-surface decomposition
- **W18:** `W18-S01` Interactive run continuation contract; `W18-S02` Full lifecycle command mutations for connected web; `W18-S03` Web full-flow operator console
- **W19:** `W19-S06` Planner metrics and scheduler visibility
- **W20:** `W20-S02` Production security and observability hardening baseline
- **W21:** `W21-S02` Installable CLI and first-run entrypoints; `W21-S05` Guided web app full-flow console
- **W23:** `W23-S02` Explicit production auth scopes; `W23-S03` Shared lifecycle service boundary
- **W24:** `W24-S02` Interactive continuation hardening
- **W27:** `W27-S02` Runtime interaction resume
- **W30:** `W30-S03` Machine-readable detached API contract
- **W31:** `W31-S01` Installed-user local app launch and onboarding UI
- **W32:** `W32-S01` Operator-request interactive runtime flow
- **W33:** `W33-S03` Failure-safe run start durable state; `W33-S04` Guided runtime-root fidelity; `W33-S05` Control-plane launch and port guidance alignment; `W33-S06` App-smoke console boundary and static snapshot removal; `W33-S07` CLI operator output ergonomics; `W33-S08` Control-plane OpenAPI payload schema depth; `W33-S09` Runtime read-model scale and pagination baseline; `W33-S10` Web app smoke module cleanup and console surface simplification
- **W34:** `W34-S01` Flow product and contract baseline; `W34-S02` Runtime and control-plane flow projections; `W34-S03` Flow-first local web shell; `W34-S04` Flow-scoped evidence, trace, and interaction workbench; `W34-S05` Closure-to-new-flow UX
- **W35:** `W35-S01` Provider heartbeat and long-running step status; `W35-S02` User-facing artifact reference renderer; `W35-S04` Execution evidence panel and interruption controls
- **W36:** `W36-S02` App workspace and project registry; `W36-S03` First-run onboarding wizard; `W36-S04` Local multi-project switcher UX
- **W40:** `W40-S02` Installed-user onboarding and release docs hardening; `W40-S03` Active internal installed-user rehearsal heartbeat surfacing
- **W41:** `W41-S02` Alpha.8 installed-user onboarding smoke refresh; `W41-S04` Alpha.8 findings closure and next-release decision
- **W42:** `W42-S02` Operator interruption owner classification cleanup
- **W43:** `W43-S02` Alpha.10 installed-user onboarding and evidence smoke; `W43-S04` Alpha.10 findings closure and next-release decision
- **W44:** `W44-S03` Artifact readiness state machine and stale transitions
- **W45:** `W45-S02` Cross-stage repair state machine and next-action resolver; `W45-S03` CLI and control-plane quality repair surfaces; `W45-S04` Web repair-cycle observability
- **W47:** `W47-S01` AOR operator keyboard accessibility and guided proof closure
- **W48:** `W48-S03` Structured repair context and convergence classification
- **W54:** `W54-S05` CLI/API/UI verification plan surfaces
- **W56:** `W56-S01` First-run console focus and action clarity; `W56-S02` Rendered cockpit UX hardening; `W56-S03` Rendered UX audit closure
- **W57:** `W57-S01` Audit disposition, release hold, and local-app threat model; `W57-S07` Atomic attempts, run control, and event identity
- **W58:** `W58-S01` Non-materializing read-model contract and runtime; `W58-S05` Asynchronous run jobs and durable live-event delivery; `W58-S06` Canonical API, OpenAPI, CLI, and service boundary; `W58-S07` Loopback-only local app transport boundary
- **W59:** `W59-S01` Executable browser and component behavior gate; `W59-S02` Local console live-state and interaction correctness; `W59-S03` Accessible local dialogs and web state decomposition; `W59-S05` Core, CLI, and control-plane decomposition

- **W60:** `W60-S03` Execution plan and evidence-derived task progress; `W60-S04` Plan workbench UX and approval flow
- **W61:** `W61-S02` Persistent local workspace registry and topology discovery; `W61-S03` Project topology CLI/API management and validation; `W61-S04` Add Project and Project Structure UX
- **W62:** `W62-S03` Parent/child Runtime Harness scheduler and bounded concurrency; `W62-S04` Integration, stale-task invalidation, and bounded repair; `W62-S05` Coordinated delivery and execution UX
- **W63:** `W63-S01` Operator journey, action semantics, and scenario baseline; `W63-S02` Semantic design system and component contracts; `W63-S03` Guided Mission intake and resumable first-flow creation; `W63-S04` Truthful action-first cockpit and recovery controls; `W63-S05` Adaptive shell and lifecycle navigation; `W63-S06` Attention queue, evidence workbench, and cockpit hierarchy; `W63-S07` Installed-console UX/UI acceptance and story closure
- **W64:** `W64-S03` Operator decision projection decomposition
## EPIC-7 Internal installed-user rehearsal
Standardize internal installed-user rehearsal, scorecards, and learning-loop operations.

**Slices by wave:**
- **W0:** `W0-S05` Internal installed-user rehearsal profile registry and no-write preflight
- **W1:** `W1-S08` Bootstrap end-to-end rehearsal
- **W2:** `W2-S06` First routed execution rehearsal
- **W3:** `W3-S06` Quality rehearsal on selected public targets
- **W4:** `W4-S06` Delivery rehearsal and recovery-safe operations
- **W5:** `W5-S05` Standard internal installed-user rehearsal orchestration runner; `W5-S06` Scorecards, incident capture, and learning-loop handoff
- **W6:** `W6-S06` Incident and audit command pack
- **W7:** `W7-S03` Incident recertification and controlled re-enable flow; `W7-S04` Finance evidence and audit durability expansion; `W7-S05` MVP+ governance and learning-loop integration closure
- **W8:** `W8-S06` Later incident and platform recertification maturity
- **W10:** `W10-S05` Externally verified internal installed-user rehearsal target-catalog proof
- **W11:** `W11-S02` Target workspace materialization for internal installed-user rehearsal; `W11-S05` Fresh external proof bundle for catalog targets
- **W12:** `W12-S02` Internal Installed-User Proof Harness; `W12-S04` Proof refresh after surface cleanup
- **W13:** `W13-S02` Curated target and feature mission catalog; `W13-S06` Full-journey proof harness and restored runner skill
- **W14:** `W14-S02` Scenario and provider catalogs; `W14-S03` Feature-size taxonomy and target mission expansion; `W14-S04` Provider-pinned full-journey profiles; `W14-S05` Proof harness and verdict expansion; `W14-S07` Proof bundle and skill refresh
- **W15:** `W15-S03` Proof verdict integrity gates
- **W16:** `W16-S05` Installed-user rehearsal runner decomposition
- **W20:** `W20-S05` Finance analytics and production monitoring loop
- **W21:** `W21-S07` Installed-user guided journey proof
- **W25:** `W25-S01` Real external-runner proof profile; `W25-S02` Code-changing full-journey pass; `W25-S03` Proof fixture and story upgrade
- **W26:** `W26-S03` Self-hosted release documentation
- **W27:** `W27-S01` Step-journal observation contract; `W27-S03` Internal installed-user rehearsal step controller output; `W27-S04` Profile and skill migration; `W27-S05` Legacy cleanup and proof alignment
- **W28:** `W28-S01` AOR install proof and setup journal; `W28-S02` Full-lifecycle and interaction gap closure; `W28-S03` Matrix target expansion
- **W30:** `W30-S04` Self-hosted operations hardening docs
- **W34:** `W34-S06` Installed-user browser-task flow-loop proof
- **W35:** `W35-S03` Operator decision helper and decision UX; `W35-S05` Codex/Qwen internal installed-user rehearsal UX proof and runbook closure
- **W36:** `W36-S05` Docs, smoke, and proof
- **W37:** `W37-S01` Internal installed-user rehearsal target setup and verification closure
- **W38:** `W38-S01` Qwen stream progress adapter closure
- **W39:** `W39-S01` Internal installed-user rehearsal provider parity policy
- **W40:** `W40-S03` Active internal installed-user rehearsal heartbeat surfacing; `W40-S04` Optional provider qualification matrix
- **W41:** `W41-S03` Alpha.8 provider qualification smoke refresh
- **W42:** `W42-S02` Operator interruption owner classification cleanup
- **W43:** `W43-S03` Alpha.10 internal installed-user rehearsal interruption and provider smoke
- **W44:** `W44-S05` Post-implementation docs and internal installed-user rehearsal validation
- **W45:** `W45-S05` Repair-loop proof fixtures and internal profile; `W45-S06` Documentation refresh and internal installed-user rehearsal acceptance
- **W46:** `W46-S01` Contract/docs breaking policy; `W46-S02` Step evaluator report and runner behavior; `W46-S03` Catalog budget and small-canary migration; `W46-S04` Product-change mission rewrite for current targets; `W46-S05` Hard target expansion; `W46-S06` Proof-complete acceptance closure and findings intake
- **W47:** `W47-S01` AOR operator keyboard accessibility and guided proof closure; `W47-S02` Internal installed-user rehearsal target verification isolation and Vitest readiness; `W47-S03` AOR repair/review convergence hardening; `W47-S04` Full proof rerun and product acceptance closure
- **W48:** `W48-S01` Quality-cycle contract and profile policy; `W48-S02` Quality-cycle runner and controller implementation; `W48-S03` Structured repair context and convergence classification; `W48-S04` Vitest target toolchain policy; `W48-S05` Control quality-cycle proof rerun and product acceptance closure (closed as W49/W50 successor-proof reconciliation, not W48-only product acceptance)
- **W49:** `W49-S01` Proof findings hygiene and evidence truthfulness; `W49-S02` Repeated repair anti-loop enforcement; `W49-S03` QA-specific step-quality evaluator hardening; `W49-S04` Full Control internal installed-user rehearsal rerun and product acceptance closure
- **W50:** `W50-S01` Review verification mapping and residual-risk classification; `W50-S02` Internal installed-user rehearsal target toolchain fail-fast and setup-journal hygiene; `W50-S03` Fastify/Vitest control rerun and product acceptance closure; `W50-S04` Findings/backlog state sync
- **W51:** `W51-S01` Clean-commit W50 proof rerun; `W51-S02` Vitest compatible Node large acceptance; `W51-S03` Automated final quality report hydration; `W51-S04` Explicit target-readiness phase; `W51-S05` Next hard-target expansion after large acceptance
- **W52:** `W52-S01` Target-readiness owner propagation; `W52-S02` Diagnostic command hang and timeout hardening; `W52-S06` Codex provider tool-surface hardening; `W52-S07` Manual xlarge step-quality continuation; `W52-S03` Vitest large product acceptance closure; `W52-S04` SQLAlchemy large diagnostic policy and acceptance closure; `W52-S05` Hard-target proof rerun and findings sync; `W52-S08` Manual step-quality assessment depth; `W52-S09` Diagnostic command classification precision; `W52-S10` Acceptance evidence matrix and xlarge observation reporting
- **W53:** `W53-S01` Generic verification command-group contract; `W53-S03` Live E2E adapter boundary mapping; `W53-S04` AOR/live E2E leak guards; `W53-S05` Generic verification archetype fixtures
- **W54:** `W54-S01` Verification group authoring contract; `W54-S07` Real archetype smoke matrix; `W54-S08` Boundary regression expansion
- **W55:** `W55-S01` Backlog intake and control finding disposition; `W55-S02` Actionable verification failure repair evidence; `W55-S03` `ky` xlarge primary verification alignment; `W55-S04` Claude xlarge context guardrails; `W55-S05` Control rerun and findings report
- **W57:** `W57-S08` Trust-boundary regression proof and release disposition
- **W58:** `W58-S03` Executable route fallback, retry, repair, and adapter semantics; `W58-S08` Runtime-quality acceptance proof
- **W59:** `W59-S01` Executable browser and component behavior gate; `W59-S06` Adapter/live-E2E decomposition and contract-kernel parity; `W59-S07` Independent audit closure and readiness decision
- **W60:** `W60-S05` Structured planning proof and documentation closure
- **W61:** `W61-S05` Topology onboarding proof and documentation closure
- **W62:** `W62-S06` Monorepo and bounded multirepo full-flow proof
- **W63:** `W63-S07` Installed-console UX/UI acceptance and story closure
