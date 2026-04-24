# Orchestrator epics

## EPIC-0 Repository development system
Turn the design package into a verifiable monorepo and contributor-safe development system.

**Slices by wave:**
- **W0:** `W0-S01` Workspace and package build baseline; `W0-S02` Contracts package and schema loader baseline; `W0-S03` Example and reference integrity checks; `W0-S04` Agent guidance and backlog workflow baseline; `W0-S06` Repository CI and acceptance gates
- **W6:** `W6-S01` Backlog and slice-cycle extensibility for W6+
- **W9:** `W9-S02` Current-state documentation drift repair
- **W11:** `W11-S01` Source-of-truth reality repair
- **W12:** `W12-S01` Public surface realignment
- **W13:** `W13-S01` Backlog-first full-journey live E2E realignment
- **W14:** `W14-S01` Backlog and source-of-truth realignment

## EPIC-1 Bootstrap and onboarding
Create a repeatable flow to turn a repository into a machine-usable target.

**Slices by wave:**
- **W1:** `W1-S02` Project init and profile loading runtime; `W1-S03` Project analysis engine and durable analysis report; `W1-S05` Project verify flow and bounded preflight execution
- **W8:** `W8-S02` Later discovery and architecture maturity pack
- **W13:** `W13-S03` Public bootstrap and feature-intent intake

## EPIC-2 Packet lifecycle
Materialize discovery, planning, handoff, release, and adjacent artifacts as durable packets.

**Slices by wave:**
- **W1:** `W1-S06` Runtime store and artifact packet materialization; `W1-S07` Wave ticket and handoff packet foundation

## EPIC-3 Routed execution
Resolve and execute steps through routes, wrappers, prompt bundles, policies, and adapters.

**Slices by wave:**
- **W2:** `W2-S01` Route registry and step resolution kernel; `W2-S02` Wrapper, prompt-bundle, and asset loader runtime; `W2-S03` Step policy resolution, budgets, and guardrails; `W2-S04` Adapter SDK and mock adapter baseline; `W2-S05` Routed step execution engine and durable step results
- **W8:** `W8-S03` Later delivery and security route-governance maturity; `W8-S08` Runtime context compiler and adapter-context injection
- **W9:** `W9-S01` Run-scoped routed evidence durability bugfix; `W9-S08` First real provider adapter and live execution foundation
- **W10:** `W10-S01` External live adapter execution baseline
- **W11:** `W11-S03` Profile-driven preflight and routed live execution
- **W13:** `W13-S04` Feature-driven discovery and execution lifecycle

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

## EPIC-5 Delivery and release
Support bounded delivery modes, manifests, and release evidence.

**Slices by wave:**
- **W4:** `W4-S01` Isolated worktree and workspace execution foundation; `W4-S02` Delivery planning and write-back mode policy; `W4-S03` Patch and local branch delivery driver; `W4-S04` Fork-first GitHub PR delivery driver; `W4-S05` Delivery manifest and release packet materialization
- **W6:** `W6-S05` Delivery/release prepare command pack
- **W8:** `W8-S07` Later multi-repo, bootstrap, and delivery rerun maturity
- **W10:** `W10-S02` Networked fork-first delivery execution
- **W11:** `W11-S04` Target-anchored delivery and release evidence

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

## EPIC-7 Live E2E and rehearsal
Standardize rehearsal, live E2E, scorecards, and learning-loop operations.

**Slices by wave:**
- **W0:** `W0-S05` Live E2E profile registry and no-write preflight
- **W1:** `W1-S08` Bootstrap end-to-end rehearsal
- **W2:** `W2-S06` First routed execution rehearsal
- **W3:** `W3-S06` Quality rehearsal on selected public targets
- **W4:** `W4-S06` Delivery rehearsal and recovery-safe operations
- **W5:** `W5-S05` Standard live E2E orchestration runner; `W5-S06` Scorecards, incident capture, and learning-loop handoff
- **W6:** `W6-S06` Incident and audit command pack
- **W7:** `W7-S03` Incident recertification and controlled re-enable flow; `W7-S04` Finance evidence and audit durability expansion; `W7-S05` MVP+ governance and learning-loop integration closure
- **W8:** `W8-S06` Later incident and platform recertification maturity
- **W10:** `W10-S05` Externally verified live E2E target-catalog proof
- **W11:** `W11-S02` Target workspace materialization for live E2E; `W11-S05` Fresh external proof bundle for catalog targets
- **W12:** `W12-S02` Internal black-box installed-user harness; `W12-S04` Proof refresh after surface cleanup
- **W13:** `W13-S02` Curated target and feature mission catalog; `W13-S06` Full-journey harness and restored runner skill
- **W14:** `W14-S02` Scenario and provider catalogs; `W14-S03` Feature-size taxonomy and target mission expansion; `W14-S04` Provider-pinned full-journey profiles; `W14-S05` Harness and verdict expansion; `W14-S07` Proof bundle and skill refresh
