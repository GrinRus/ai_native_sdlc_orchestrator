# Slice dependency graph

This graph mirrors the hard dependencies from the wave documents and master backlog.

```mermaid
graph TD
  W0S01[W0-S01 Workspace and package build baseline]
  W0S02[W0-S02 Contracts package and schema loader baseline]
  W0S03[W0-S03 Example and reference integrity checks]
  W0S04[W0-S04 Agent guidance and backlog workflow baseline]
  W0S05[W0-S05 Live E2E profile registry and no-write preflight]
  W0S06[W0-S06 Repository CI and acceptance gates]
  W1S01[W1-S01 Bootstrap CLI shell and command contracts]
  W1S02[W1-S02 Project init and profile loading runtime]
  W1S03[W1-S03 Project analysis engine and durable analysis report]
  W1S04[W1-S04 Deterministic project validate flow]
  W1S05[W1-S05 Project verify flow and bounded preflight execution]
  W1S06[W1-S06 Runtime store and artifact packet materialization]
  W1S07[W1-S07 Wave ticket and handoff packet foundation]
  W1S08[W1-S08 Bootstrap end-to-end rehearsal]
  W2S01[W2-S01 Route registry and step resolution kernel]
  W2S02[W2-S02 Wrapper, prompt-bundle, and asset loader runtime]
  W2S03[W2-S03 Step policy resolution, budgets, and guardrails]
  W2S04[W2-S04 Adapter SDK and mock adapter baseline]
  W2S05[W2-S05 Routed step execution engine and durable step results]
  W2S06[W2-S06 First routed execution rehearsal]
  W3S01[W3-S01 Validation kernel generalization and asset graph checks]
  W3S02[W3-S02 Dataset and evaluation suite registry]
  W3S03[W3-S03 Eval runner and scorer interface]
  W3S04[W3-S04 Harness capture and replay runtime]
  W3S05[W3-S05 Certification and promotion decision baseline]
  W3S06[W3-S06 Quality rehearsal on selected public targets]
  W4S01[W4-S01 Isolated worktree and workspace execution foundation]
  W4S02[W4-S02 Delivery planning and write-back mode policy]
  W4S03[W4-S03 Patch and local branch delivery driver]
  W4S04[W4-S04 Fork-first GitHub PR delivery driver]
  W4S05[W4-S05 Delivery manifest and release packet materialization]
  W4S06[W4-S06 Delivery rehearsal and recovery-safe operations]
  W5S01[W5-S01 Control plane API read surface]
  W5S02[W5-S02 Live run event stream]
  W5S03[W5-S03 CLI operator commands beyond bootstrap]
  W5S04[W5-S04 Detachable web UI baseline]
  W5S05[W5-S05 Standard live E2E orchestration runner]
  W5S06[W5-S06 Scorecards, incident capture, and learning-loop handoff]
  W6S01[W6-S01 Backlog and slice-cycle extensibility for W6+]
  W6S02[W6-S02 Intake/discovery/spec/wave command pack]
  W6S03[W6-S03 Run-control command pack with policy and audit guardrails]
  W6S04[W6-S04 UI attach/detach lifecycle command pack]
  W6S05[W6-S05 Delivery/release prepare command pack]
  W6S06[W6-S06 Incident and audit command pack]
  W7S01[W7-S01 Governance quality guardrails and evidence parity]
  W7S02[W7-S02 AI platform promotion/freeze maturity pack]
  W7S03[W7-S03 Incident recertification and controlled re-enable flow]
  W7S04[W7-S04 Finance evidence and audit durability expansion]
  W7S05[W7-S05 MVP+ governance and learning-loop integration closure]
  W8S01[W8-S01 Sponsor and planner strategic visibility expansion]
  W8S02[W8-S02 Later discovery and architecture maturity pack]
  W8S03[W8-S03 Later delivery and security route-governance maturity]
  W8S04[W8-S04 Later operator event and policy visibility expansion]
  W8S05[W8-S05 Later QA and AI platform baseline comparison maturity]
  W8S06[W8-S06 Later incident and platform recertification maturity]
  W8S07[W8-S07 Later multi-repo, bootstrap, and delivery rerun maturity]
  W8S08[W8-S08 Runtime context compiler and adapter-context injection]
  W8S09[W8-S09 Context asset lifecycle and quality-gated update flow]
  W9S01[W9-S01 Run-scoped routed evidence durability bugfix]
  W9S02[W9-S02 Current-state documentation drift repair]
  W9S03[W9-S03 Control-plane API contract/runtime alignment]
  W9S04[W9-S04 Machine-checkable control-plane API contract coverage]
  W9S05[W9-S05 Public harness replay command surface]
  W9S06[W9-S06 Asset promote/freeze command surface completion]
  W9S07[W9-S07 Detached HTTP control-plane transport baseline]
  W9S08[W9-S08 First real provider adapter and live execution foundation]
  W10S01[W10-S01 External live adapter execution baseline]
  W10S02[W10-S02 Networked fork-first delivery execution]
  W10S03[W10-S03 Detached transport mutation command baseline]
  W10S04[W10-S04 Detached transport authn/authz hardening baseline]
  W10S05[W10-S05 Externally verified live E2E target-catalog proof]
  W11S01[W11-S01 Source-of-truth reality repair]
  W11S02[W11-S02 Target workspace materialization for live E2E]
  W11S03[W11-S03 Profile-driven preflight and routed live execution]
  W11S04[W11-S04 Target-anchored delivery and release evidence]
  W11S05[W11-S05 Fresh external proof bundle for catalog targets]
  W12S01[W12-S01 Public surface realignment]
  W12S02[W12-S02 Live E2E Installed-User Proof Runner]
  W12S03[W12-S03 Breaking CLI and contract removal]
  W12S04[W12-S04 Proof refresh after surface cleanup]
  W13S01[W13-S01 Backlog-first full-journey live E2E realignment]
  W13S02[W13-S02 Curated target and feature mission catalog]
  W13S03[W13-S03 Public bootstrap and feature-intent intake]
  W13S04[W13-S04 Feature-driven discovery and execution lifecycle]
  W13S05[W13-S05 Public review and learning-loop closure surfaces]
  W13S06[W13-S06 Full-journey proof runner and restored runner skill]
  W14S01[W14-S01 Backlog and source-of-truth realignment]
  W14S02[W14-S02 Scenario and provider catalogs]
  W14S03[W14-S03 Feature-size taxonomy and target mission expansion]
  W14S04[W14-S04 Provider-pinned full-journey profiles]
  W14S05[W14-S05 Proof runner and verdict expansion]
  W14S06[W14-S06 Review, audit, and closure alignment]
  W14S07[W14-S07 Proof bundle and skill refresh]
  W15S01[W15-S01 Source-of-truth and readiness queue repair]
  W15S02[W15-S02 Package/module workspace alignment]
  W15S03[W15-S03 Proof verdict integrity gates]
  W16S01[W16-S01 Complexity baseline and shared helper extraction]
  W16S02[W16-S02 CLI dispatcher decomposition]
  W16S03[W16-S03 API and read-surface decomposition]
  W16S04[W16-S04 Orchestrator-core execution decomposition]
  W16S05[W16-S05 Installed-user live E2E runner decomposition]
  W16S06[W16-S06 Adapter permission legacy removal]
  W17S01[W17-S01 Legacy surface cleanup after W16]
  W18S01[W18-S01 Interactive run continuation contract]
  W18S02[W18-S02 Full lifecycle command mutations for connected web]
  W18S03[W18-S03 Web full-flow operator console]
  W18S04[W18-S04 Monorepo and bounded multirepo flow proof]
  W19S01[W19-S01 User-story registry and coverage evidence matrix]
  W19S02[W19-S02 Product intake source and KPI/DoD model]
  W19S03[W19-S03 Discovery research and ADR evidence flow]
  W19S04[W19-S04 Incident-to-dataset backfill workflow]
  W19S05[W19-S05 Review decision and approval workflow]
  W19S06[W19-S06 Planner metrics and scheduler visibility]
  W20S01[W20-S01 Multirepo scoped locks and cross-repo validation]
  W20S02[W20-S02 Production security and observability hardening baseline]
  W20S03[W20-S03 OpenCode candidate evidence and downgrade follow-up]
  W20S04[W20-S04 Compiler revision asset lifecycle]
  W20S05[W20-S05 Finance analytics and production monitoring loop]
  W21S01[W21-S01 Installed-user onboarding UX contract]
  W21S02[W21-S02 Installable CLI and first-run entrypoints]
  W21S03[W21-S03 Clean project onboarding and asset-root resolution]
  W21S04[W21-S04 Guided mission intake and next-action resolver]
  W21S05[W21-S05 Guided web app full-flow console]
  W21S06[W21-S06 Review, delivery, release, and learning closure UX]
  W21S07[W21-S07 Installed-user guided journey proof]
  W22S01[W22-S01 Evidence-strength story coverage model]
  W22S02[W22-S02 Production readiness source-of-truth]
  W22S03[W22-S03 OpenCode maturity downgrade]
  W23S01[W23-S01 Nested contract validation pack]
  W23S02[W23-S02 Explicit production auth scopes]
  W23S03[W23-S03 Shared lifecycle service boundary]
  W24S01[W24-S01 Run-level Runtime Harness controller]
  W24S02[W24-S02 Interactive continuation hardening]
  W24S03[W24-S03 Strict delivery gate consolidation]
  W25S01[W25-S01 Real external-runner proof profile]
  W25S02[W25-S02 Code-changing full-journey pass]
  W25S03[W25-S03 Proof fixture and story upgrade]
  W26S01[W26-S01 Production readiness gate]
  W26S02[W26-S02 Maintainability stabilization]
  W26S03[W26-S03 Self-hosted release documentation]
  W27S01[W27-S01 Step-journal observation contract]
  W27S02[W27-S02 Runtime interaction resume]
  W27S03[W27-S03 Live E2E step controller output]
  W27S04[W27-S04 Profile and skill migration]
  W27S05[W27-S05 Legacy cleanup and proof alignment]
  W28S01[W28-S01 AOR install proof and setup journal]
  W28S02[W28-S02 Full-lifecycle and interaction gap closure]
  W28S03[W28-S03 Matrix target expansion]
  W29S01[W29-S01 npm CLI alpha release channel]
  W30S01[W30-S01 Post-W29 alpha-hardening planning source of truth]
  W30S02[W30-S02 Alpha architecture decision records]
  W30S03[W30-S03 Machine-readable detached API contract]
  W30S04[W30-S04 Self-hosted operations hardening docs]
  W30S05[W30-S05 Alpha readiness gate expansion]
  W30S06[W30-S06 Alpha release and onboarding proof refresh]
  W31S01[W31-S01 Installed-user local app launch and onboarding UI]
  W32S01[W32-S01 Operator-request interactive runtime flow]
  W33S01[W33-S01 Console flow source-of-truth and static snapshot removal]
  W33S02[W33-S02 Reliable root gates and live E2E timeout bounds]
  W33S03[W33-S03 Failure-safe run start durable state]
  W33S04[W33-S04 Guided runtime-root fidelity]
  W33S05[W33-S05 Control-plane launch and port guidance alignment]
  W33S06[W33-S06 App-smoke console boundary and static snapshot removal]
  W33S07[W33-S07 CLI operator output ergonomics]
  W33S08[W33-S08 Control-plane OpenAPI payload schema depth]
  W33S09[W33-S09 Runtime read-model scale and pagination baseline]
  W33S10[W33-S10 Web app smoke module cleanup and console surface simplification]
  W34S01[W34-S01 Flow product and contract baseline]
  W34S02[W34-S02 Runtime and control-plane flow projections]
  W34S03[W34-S03 Flow-first local web shell]
  W34S04[W34-S04 Flow-scoped evidence, trace, and interaction workbench]
  W34S05[W34-S05 Closure-to-new-flow UX]
  W34S06[W34-S06 Installed-user browser-task flow-loop proof]
  W34S07[W34-S07 Backlog, docs, and release-gate alignment]
  W35S01[W35-S01 Provider heartbeat and long-running step status]
  W35S02[W35-S02 User-facing artifact reference renderer]
  W35S03[W35-S03 Operator decision helper and decision UX]
  W35S04[W35-S04 Execution evidence panel and interruption controls]
  W35S05[W35-S05 Codex/Qwen live E2E UX proof and runbook closure]
  W36S01[W36-S01 No-settings onboarding and workspace contract baseline]
  W36S02[W36-S02 App workspace and project registry]
  W36S03[W36-S03 First-run onboarding wizard]
  W36S04[W36-S04 Local multi-project switcher UX]
  W36S05[W36-S05 Docs, smoke, and proof]
  W37S01[W37-S01 Live E2E target setup and verification closure]

  W0S01 --> W0S02
  W0S02 --> W0S03
  W0S02 --> W0S05
  W0S03 --> W0S05
  W0S01 --> W0S06
  W0S03 --> W0S06
  W0S04 --> W0S06
  W0S05 --> W0S06
  W0S01 --> W1S01
  W0S02 --> W1S01
  W1S01 --> W1S02
  W1S02 --> W1S03
  W1S02 --> W1S04
  W0S03 --> W1S04
  W1S03 --> W1S05
  W1S04 --> W1S05
  W0S05 --> W1S05
  W1S02 --> W1S06
  W1S04 --> W1S07
  W1S06 --> W1S07
  W1S03 --> W1S08
  W1S04 --> W1S08
  W1S05 --> W1S08
  W1S07 --> W1S08
  W1S08 --> W2S01
  W2S01 --> W2S02
  W2S01 --> W2S03
  W2S01 --> W2S04
  W2S02 --> W2S05
  W2S03 --> W2S05
  W2S04 --> W2S05
  W1S06 --> W2S05
  W2S05 --> W2S06
  W1S07 --> W2S06
  W0S05 --> W2S06
  W2S05 --> W3S01
  W1S04 --> W3S01
  W3S01 --> W3S02
  W3S02 --> W3S03
  W2S04 --> W3S03
  W2S05 --> W3S03
  W3S02 --> W3S04
  W2S05 --> W3S04
  W3S03 --> W3S05
  W3S04 --> W3S05
  W3S05 --> W3S06
  W0S05 --> W3S06
  W2S05 --> W4S01
  W1S05 --> W4S01
  W4S01 --> W4S02
  W1S07 --> W4S02
  W3S05 --> W4S02
  W4S02 --> W4S03
  W4S02 --> W4S04
  W2S04 --> W4S04
  W4S03 --> W4S05
  W4S04 --> W4S05
  W3S05 --> W4S05
  W4S05 --> W4S06
  W0S05 --> W4S06
  W4S05 --> W5S01
  W2S05 --> W5S01
  W5S01 --> W5S02
  W2S05 --> W5S02
  W5S01 --> W5S03
  W5S02 --> W5S03
  W5S01 --> W5S04
  W5S02 --> W5S04
  W5S03 --> W5S05
  W4S06 --> W5S05
  W3S06 --> W5S05
  W5S05 --> W5S06
  W3S05 --> W5S06
  W5S06 --> W6S01
  W6S01 --> W6S02
  W6S01 --> W6S03
  W5S03 --> W6S03
  W6S03 --> W6S04
  W5S04 --> W6S04
  W6S03 --> W6S05
  W4S05 --> W6S05
  W6S03 --> W6S06
  W5S06 --> W6S06
  W6S03 --> W7S01
  W3S04 --> W7S01
  W7S01 --> W7S02
  W3S05 --> W7S02
  W7S02 --> W7S03
  W6S06 --> W7S03
  W6S06 --> W7S04
  W7S02 --> W7S05
  W7S03 --> W7S05
  W7S04 --> W7S05
  W7S05 --> W8S01
  W6S02 --> W8S02
  W7S05 --> W8S02
  W6S03 --> W8S03
  W7S05 --> W8S03
  W8S08 --> W8S03
  W6S03 --> W8S04
  W7S05 --> W8S04
  W8S08 --> W8S04
  W7S01 --> W8S05
  W7S02 --> W8S05
  W7S03 --> W8S06
  W7S04 --> W8S06
  W7S05 --> W8S06
  W6S05 --> W8S07
  W6S02 --> W8S07
  W8S04 --> W8S07
  W8S06 --> W8S07
  W6S03 --> W8S08
  W7S05 --> W8S08
  W8S08 --> W8S09
  W7S02 --> W8S09
  W8S05 --> W8S09
  W8S08 --> W9S01
  W8S04 --> W9S03
  W9S03 --> W9S04
  W3S04 --> W9S05
  W8S05 --> W9S05
  W7S02 --> W9S06
  W8S09 --> W9S06
  W9S03 --> W9S07
  W9S04 --> W9S07
  W9S01 --> W9S08
  W8S03 --> W9S08
  W8S08 --> W9S08
  W9S08 --> W10S01
  W4S04 --> W10S02
  W6S05 --> W10S02
  W9S07 --> W10S03
  W6S03 --> W10S03
  W6S04 --> W10S03
  W10S03 --> W10S04
  W10S01 --> W10S05
  W10S02 --> W10S05
  W11S05 --> W10S05
  W11S01 --> W11S02
  W11S02 --> W11S03
  W11S03 --> W11S04
  W11S04 --> W11S05
  W12S01 --> W12S02
  W12S02 --> W12S03
  W12S03 --> W12S04
  W13S01 --> W13S02
  W13S02 --> W13S03
  W13S03 --> W13S04
  W13S04 --> W13S05
  W13S05 --> W13S06
  W14S01 --> W14S02
  W14S02 --> W14S03
  W14S03 --> W14S04
  W14S04 --> W14S05
  W14S05 --> W14S06
  W14S06 --> W14S07
  W15S01 --> W15S02
  W15S01 --> W15S03
  W16S01 --> W16S02
  W16S01 --> W16S03
  W16S01 --> W16S04
  W16S01 --> W16S05
  W16S01 --> W16S06
  W16S02 --> W17S01
  W16S04 --> W17S01
  W16S05 --> W17S01
  W16S06 --> W17S01
  W18S01 --> W18S02
  W18S02 --> W18S03
  W17S01 --> W19S01
  W19S01 --> W19S02
  W13S03 --> W19S02
  W19S02 --> W19S03
  W8S02 --> W19S03
  W19S01 --> W19S04
  W7S03 --> W19S04
  W13S05 --> W19S04
  W19S01 --> W19S05
  W13S05 --> W19S05
  W14S06 --> W19S05
  W19S01 --> W19S06
  W6S03 --> W19S06
  W8S01 --> W19S06
  W19S01 --> W20S01
  W8S07 --> W20S01
  W19S01 --> W20S02
  W10S04 --> W20S02
  W16S06 --> W20S03
  W20S02 --> W20S03
  W19S01 --> W20S04
  W8S09 --> W20S04
  W20S02 --> W20S05
  W7S04 --> W20S05
  W19S01 --> W21S01
  W21S01 --> W21S02
  W21S01 --> W21S03
  W19S02 --> W21S04
  W21S03 --> W21S04
  W18S03 --> W21S05
  W21S04 --> W21S05
  W19S05 --> W21S06
  W21S05 --> W21S06
  W21S02 --> W21S07
  W21S03 --> W21S07
  W21S04 --> W21S07
  W21S05 --> W21S07
  W21S06 --> W21S07
  W22S01 --> W22S02
  W22S01 --> W22S03
  W22S01 --> W23S01
  W22S02 --> W23S02
  W22S02 --> W23S03
  W23S01 --> W24S01
  W23S03 --> W24S01
  W24S01 --> W24S02
  W23S02 --> W24S02
  W24S01 --> W24S03
  W23S01 --> W24S03
  W24S01 --> W25S01
  W23S02 --> W25S01
  W25S01 --> W25S02
  W24S03 --> W25S02
  W25S02 --> W25S03
  W22S01 --> W25S03
  W25S03 --> W26S01
  W23S01 --> W26S01
  W23S02 --> W26S01
  W24S01 --> W26S01
  W26S01 --> W26S02
  W26S01 --> W26S03
  W26S03 --> W27S01
  W27S01 --> W27S02
  W27S01 --> W27S03
  W27S02 --> W27S03
  W27S03 --> W27S04
  W27S04 --> W27S05
  W27S05 --> W28S01
  W28S01 --> W28S02
  W28S01 --> W28S03
  W28S03 --> W29S01
  W29S01 --> W30S01
  W30S01 --> W30S02
  W30S02 --> W30S03
  W30S03 --> W30S04
  W30S04 --> W30S05
  W30S05 --> W30S06
  W30S06 --> W31S01
  W31S01 --> W32S01
  W24S02 --> W32S01
  W32S01 --> W33S01
  W33S01 --> W33S02
  W33S02 --> W33S03
  W33S02 --> W33S04
  W33S04 --> W33S05
  W33S02 --> W33S06
  W33S04 --> W33S07
  W33S02 --> W33S08
  W33S02 --> W33S09
  W33S06 --> W33S10
  W33S10 --> W34S01
  W32S01 --> W34S01
  W21S07 --> W34S01
  W34S01 --> W34S02
  W34S02 --> W34S03
  W34S02 --> W34S04
  W34S02 --> W34S05
  W34S03 --> W34S06
  W34S04 --> W34S06
  W34S05 --> W34S06
  W34S06 --> W34S07
  W34S07 --> W35S01
  W35S01 --> W35S02
  W35S02 --> W35S03
  W35S01 --> W35S04
  W35S02 --> W35S04
  W35S03 --> W35S04
  W35S04 --> W35S05
  W35S04 --> W36S01
  W36S01 --> W36S02
  W36S02 --> W36S03
  W36S03 --> W36S04
  W36S04 --> W36S05
  W35S04 --> W37S01
```

## W0 hard dependencies
| Slice ID | Depends on |
|---|---|
| W0-S01 | none |
| W0-S02 | W0-S01 |
| W0-S03 | W0-S02 |
| W0-S04 | none |
| W0-S05 | W0-S02, W0-S03 |
| W0-S06 | W0-S01, W0-S03, W0-S04, W0-S05 |

## W1 hard dependencies
| Slice ID | Depends on |
|---|---|
| W1-S01 | W0-S01, W0-S02 |
| W1-S02 | W1-S01 |
| W1-S03 | W1-S02 |
| W1-S04 | W1-S02, W0-S03 |
| W1-S05 | W1-S03, W1-S04, W0-S05 |
| W1-S06 | W1-S02 |
| W1-S07 | W1-S04, W1-S06 |
| W1-S08 | W1-S03, W1-S04, W1-S05, W1-S07 |

## W2 hard dependencies
| Slice ID | Depends on |
|---|---|
| W2-S01 | W1-S08 |
| W2-S02 | W2-S01 |
| W2-S03 | W2-S01 |
| W2-S04 | W2-S01 |
| W2-S05 | W2-S02, W2-S03, W2-S04, W1-S06 |
| W2-S06 | W2-S05, W1-S07, W0-S05 |

## W3 hard dependencies
| Slice ID | Depends on |
|---|---|
| W3-S01 | W2-S05, W1-S04 |
| W3-S02 | W3-S01 |
| W3-S03 | W3-S02, W2-S04, W2-S05 |
| W3-S04 | W3-S02, W2-S05 |
| W3-S05 | W3-S03, W3-S04 |
| W3-S06 | W3-S05, W0-S05 |

## W4 hard dependencies
| Slice ID | Depends on |
|---|---|
| W4-S01 | W2-S05, W1-S05 |
| W4-S02 | W4-S01, W1-S07, W3-S05 |
| W4-S03 | W4-S02 |
| W4-S04 | W4-S02, W2-S04 |
| W4-S05 | W4-S03, W4-S04, W3-S05 |
| W4-S06 | W4-S05, W0-S05 |

## W5 hard dependencies
| Slice ID | Depends on |
|---|---|
| W5-S01 | W4-S05, W2-S05 |
| W5-S02 | W5-S01, W2-S05 |
| W5-S03 | W5-S01, W5-S02 |
| W5-S04 | W5-S01, W5-S02 |
| W5-S05 | W5-S03, W4-S06, W3-S06 |
| W5-S06 | W5-S05, W3-S05 |

## W6 hard dependencies
| Slice ID | Depends on |
|---|---|
| W6-S01 | W5-S06 |
| W6-S02 | W6-S01 |
| W6-S03 | W6-S01, W5-S03 |
| W6-S04 | W6-S03, W5-S04 |
| W6-S05 | W6-S03, W4-S05 |
| W6-S06 | W6-S03, W5-S06 |

## W7 hard dependencies
| Slice ID | Depends on |
|---|---|
| W7-S01 | W6-S03, W3-S04 |
| W7-S02 | W7-S01, W3-S05 |
| W7-S03 | W7-S02, W6-S06 |
| W7-S04 | W6-S06 |
| W7-S05 | W7-S02, W7-S03, W7-S04 |

## W8 hard dependencies
| Slice ID | Depends on |
|---|---|
| W8-S01 | W7-S05 |
| W8-S02 | W6-S02, W7-S05 |
| W8-S03 | W6-S03, W7-S05, W8-S08 |
| W8-S04 | W6-S03, W7-S05, W8-S08 |
| W8-S05 | W7-S01, W7-S02 |
| W8-S06 | W7-S03, W7-S04, W7-S05 |
| W8-S07 | W6-S05, W6-S02, W8-S04, W8-S06 |
| W8-S08 | W6-S03, W7-S05 |
| W8-S09 | W8-S08, W7-S02, W8-S05 |

## W9 hard dependencies
| Slice ID | Depends on |
|---|---|
| W9-S01 | W8-S08 |
| W9-S02 | none |
| W9-S03 | W8-S04 |
| W9-S04 | W9-S03 |
| W9-S05 | W3-S04, W8-S05 |
| W9-S06 | W7-S02, W8-S09 |
| W9-S07 | W9-S03, W9-S04 |
| W9-S08 | W9-S01, W8-S03, W8-S08 |

## W10 hard dependencies
| Slice ID | Depends on |
|---|---|
| W10-S01 | W9-S08 |
| W10-S02 | W4-S04, W6-S05 |
| W10-S03 | W9-S07, W6-S03, W6-S04 |
| W10-S04 | W10-S03 |
| W10-S05 | W10-S01, W10-S02, W11-S05 |

## W11 hard dependencies
| Slice ID | Depends on |
|---|---|
| W11-S01 | none |
| W11-S02 | W11-S01 |
| W11-S03 | W11-S02 |
| W11-S04 | W11-S03 |
| W11-S05 | W11-S04 |

## W12 hard dependencies
| Slice ID | Depends on |
|---|---|
| W12-S01 | none |
| W12-S02 | W12-S01 |
| W12-S03 | W12-S02 |
| W12-S04 | W12-S03 |

## W13 hard dependencies
| Slice ID | Depends on |
|---|---|
| W13-S01 | none |
| W13-S02 | W13-S01 |
| W13-S03 | W13-S02 |
| W13-S04 | W13-S03 |
| W13-S05 | W13-S04 |
| W13-S06 | W13-S05 |

## W14 hard dependencies
| Slice ID | Depends on |
|---|---|
| W14-S01 | none |
| W14-S02 | W14-S01 |
| W14-S03 | W14-S02 |
| W14-S04 | W14-S03 |
| W14-S05 | W14-S04 |
| W14-S06 | W14-S05 |
| W14-S07 | W14-S06 |

## W15 hard dependencies
| Slice ID | Depends on |
|---|---|
| W15-S01 | none |
| W15-S02 | W15-S01 |
| W15-S03 | W15-S01 |

## W16 hard dependencies
| Slice ID | Depends on |
|---|---|
| W16-S01 | none |
| W16-S02 | W16-S01 |
| W16-S03 | W16-S01 |
| W16-S04 | W16-S01 |
| W16-S05 | W16-S01 |
| W16-S06 | W16-S01 |

## W17 hard dependencies
| Slice ID | Depends on |
|---|---|
| W17-S01 | W16-S02, W16-S04, W16-S05, W16-S06 |

## W18 hard dependencies
| Slice ID | Depends on |
|---|---|
| W18-S01 | none |
| W18-S02 | W18-S01 |
| W18-S03 | W18-S02 |
| W18-S04 | none |

## W19 hard dependencies
| Slice ID | Depends on |
|---|---|
| W19-S01 | W17-S01 |
| W19-S02 | W19-S01, W13-S03 |
| W19-S03 | W19-S02, W8-S02 |
| W19-S04 | W19-S01, W7-S03, W13-S05 |
| W19-S05 | W19-S01, W13-S05, W14-S06 |
| W19-S06 | W19-S01, W6-S03, W8-S01 |

## W20 hard dependencies
| Slice ID | Depends on |
|---|---|
| W20-S01 | W19-S01, W8-S07 |
| W20-S02 | W19-S01, W10-S04 |
| W20-S03 | W16-S06, W20-S02 |
| W20-S04 | W19-S01, W8-S09 |
| W20-S05 | W20-S02, W7-S04 |

## W21 hard dependencies
| Slice ID | Depends on |
|---|---|
| W21-S01 | W19-S01 |
| W21-S02 | W21-S01 |
| W21-S03 | W21-S01 |
| W21-S04 | W19-S02, W21-S03 |
| W21-S05 | W18-S03, W21-S04 |
| W21-S06 | W19-S05, W21-S05 |
| W21-S07 | W21-S02, W21-S03, W21-S04, W21-S05, W21-S06 |

## W22 hard dependencies
| Slice ID | Depends on |
|---|---|
| W22-S01 | none |
| W22-S02 | W22-S01 |
| W22-S03 | W22-S01 |

## W23 hard dependencies
| Slice ID | Depends on |
|---|---|
| W23-S01 | W22-S01 |
| W23-S02 | W22-S02 |
| W23-S03 | W22-S02 |

## W24 hard dependencies
| Slice ID | Depends on |
|---|---|
| W24-S01 | W23-S01, W23-S03 |
| W24-S02 | W24-S01, W23-S02 |
| W24-S03 | W24-S01, W23-S01 |

## W25 hard dependencies
| Slice ID | Depends on |
|---|---|
| W25-S01 | W24-S01, W23-S02 |
| W25-S02 | W25-S01, W24-S03 |
| W25-S03 | W25-S02, W22-S01 |

## W26 hard dependencies
| Slice ID | Depends on |
|---|---|
| W26-S01 | W25-S03, W23-S01, W23-S02, W24-S01 |
| W26-S02 | W26-S01 |
| W26-S03 | W26-S01 |

## W27 hard dependencies
| Slice ID | Depends on |
|---|---|
| W27-S01 | W26-S03 |
| W27-S02 | W27-S01 |
| W27-S03 | W27-S01, W27-S02 |
| W27-S04 | W27-S03 |
| W27-S05 | W27-S04 |

## W28 hard dependencies
| Slice ID | Depends on |
|---|---|
| W28-S01 | W27-S05 |
| W28-S02 | W28-S01 |
| W28-S03 | W28-S01 |

## W29 hard dependencies
| Slice ID | Depends on |
|---|---|
| W29-S01 | W28-S03 |

## W30 hard dependencies
| Slice ID | Depends on |
|---|---|
| W30-S01 | W29-S01 |
| W30-S02 | W30-S01 |
| W30-S03 | W30-S02 |
| W30-S04 | W30-S03 |
| W30-S05 | W30-S04 |
| W30-S06 | W30-S05 |

## W31 hard dependencies
| Slice ID | Depends on |
|---|---|
| W31-S01 | W30-S06 |

## W32 hard dependencies
| Slice ID | Depends on |
|---|---|
| W32-S01 | W31-S01, W24-S02 |

## W33 hard dependencies
| Slice ID | Depends on |
|---|---|
| W33-S01 | W32-S01 |
| W33-S02 | W33-S01 |
| W33-S03 | W33-S02 |
| W33-S04 | W33-S02 |
| W33-S05 | W33-S04 |
| W33-S06 | W33-S02 |
| W33-S07 | W33-S04 |
| W33-S08 | W33-S02 |
| W33-S09 | W33-S02 |
| W33-S10 | W33-S06 |

## W34 hard dependencies
| Slice ID | Depends on |
|---|---|
| W34-S01 | W33-S10, W32-S01, W21-S07 |
| W34-S02 | W34-S01 |
| W34-S03 | W34-S02 |
| W34-S04 | W34-S02 |
| W34-S05 | W34-S02 |
| W34-S06 | W34-S03, W34-S04, W34-S05 |
| W34-S07 | W34-S06 |

## W35 hard dependencies
| Slice ID | Depends on |
|---|---|
| W35-S01 | W34-S07 |
| W35-S02 | W35-S01 |
| W35-S03 | W35-S02 |
| W35-S04 | W35-S01, W35-S02, W35-S03 |
| W35-S05 | W35-S04 |

## W36 hard dependencies
| Slice ID | Depends on |
|---|---|
| W36-S01 | W35-S04 |
| W36-S02 | W36-S01 |
| W36-S03 | W36-S02 |
| W36-S04 | W36-S03 |
| W36-S05 | W36-S04 |

## W37 hard dependencies
| Slice ID | Depends on |
|---|---|
| W37-S01 | W35-S04 |

## Topological order
1. W0-S01
2. W0-S02
3. W0-S03
4. W0-S04
5. W0-S05
6. W0-S06
7. W1-S01
8. W1-S02
9. W1-S03
10. W1-S04
11. W1-S05
12. W1-S06
13. W1-S07
14. W1-S08
15. W2-S01
16. W2-S02
17. W2-S03
18. W2-S04
19. W2-S05
20. W2-S06
21. W3-S01
22. W3-S02
23. W3-S03
24. W3-S04
25. W3-S05
26. W3-S06
27. W4-S01
28. W4-S02
29. W4-S03
30. W4-S04
31. W4-S05
32. W4-S06
33. W5-S01
34. W5-S02
35. W5-S03
36. W5-S04
37. W5-S05
38. W5-S06
39. W6-S01
40. W6-S02
41. W6-S03
42. W6-S04
43. W6-S05
44. W6-S06
45. W7-S01
46. W7-S02
47. W7-S03
48. W7-S04
49. W7-S05
50. W8-S01
51. W8-S02
52. W8-S03
53. W8-S04
54. W8-S05
55. W8-S06
56. W8-S07
57. W8-S08
58. W8-S09
59. W9-S01
60. W9-S02
61. W9-S03
62. W9-S04
63. W9-S05
64. W9-S06
65. W9-S07
66. W9-S08
67. W10-S01
68. W10-S02
69. W10-S03
70. W10-S04
71. W10-S05
72. W11-S01
73. W11-S02
74. W11-S03
75. W11-S04
76. W11-S05
77. W12-S01
78. W12-S02
79. W12-S03
80. W12-S04
81. W13-S01
82. W13-S02
83. W13-S03
84. W13-S04
85. W13-S05
86. W13-S06
87. W14-S01
88. W14-S02
89. W14-S03
90. W14-S04
91. W14-S05
92. W14-S06
93. W14-S07
94. W15-S01
95. W15-S02
96. W15-S03
97. W16-S01
98. W16-S02
99. W16-S03
100. W16-S04
101. W16-S05
102. W16-S06
103. W17-S01
104. W18-S01
105. W18-S02
106. W18-S03
107. W18-S04
108. W19-S01
109. W19-S02
110. W19-S03
111. W19-S04
112. W19-S05
113. W19-S06
114. W20-S01
115. W20-S02
116. W20-S03
117. W20-S04
118. W20-S05
119. W21-S01
120. W21-S02
121. W21-S03
122. W21-S04
123. W21-S05
124. W21-S06
125. W21-S07
126. W22-S01
127. W22-S02
128. W22-S03
129. W23-S01
130. W23-S02
131. W23-S03
132. W24-S01
133. W24-S02
134. W24-S03
135. W25-S01
136. W25-S02
137. W25-S03
138. W26-S01
139. W26-S02
140. W26-S03
141. W27-S01
142. W27-S02
143. W27-S03
144. W27-S04
145. W27-S05
146. W28-S01
147. W28-S02
148. W28-S03
149. W29-S01
150. W30-S01
151. W30-S02
152. W30-S03
153. W30-S04
154. W30-S05
155. W30-S06
156. W31-S01
157. W32-S01
158. W33-S01
159. W33-S02
160. W33-S03
161. W33-S04
162. W33-S05
163. W33-S06
164. W33-S07
165. W33-S08
166. W33-S09
167. W33-S10
168. W34-S01
169. W34-S02
170. W34-S03
171. W34-S04
172. W34-S05
173. W34-S06
174. W34-S07
175. W35-S01
176. W35-S02
177. W35-S03
178. W35-S04
179. W35-S05
180. W36-S01
181. W36-S02
182. W36-S03
183. W36-S04
184. W36-S05
185. W37-S01

## Planning rule
If a slice becomes too large during implementation, split it by introducing a new slice between existing hard dependencies rather than hiding extra work inside local tasks. Update the owning wave document, the master backlog, the epic map, and this graph together.
