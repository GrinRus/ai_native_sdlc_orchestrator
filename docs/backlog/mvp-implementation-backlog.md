# MVP implementation backlog

This is the master index for the implementation slices across all defined waves.

## How to use this file
- pick a **ready** slice when possible;
- derive the local task plan from the owning wave document instead of inventing a new shared backlog item;
- verify hard dependencies in `docs/backlog/slice-dependency-graph.md` before starting blocked work;
- update the owning wave document, this master index, and the dependency graph together when a slice changes shape;

## W0 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W0-S01 | Workspace and package build baseline | EPIC-0 | done | root workspace files, `apps/**`, `packages/**` | none |
| W0-S02 | Contracts package and schema loader baseline | EPIC-0 | done | `packages/contracts`, `docs/contracts/**`, `examples/**` | W0-S01 |
| W0-S03 | Example and reference integrity checks | EPIC-0 | done | `packages/contracts`, `examples/**`, root validation scripts | W0-S02 |
| W0-S04 | Agent guidance and backlog workflow baseline | EPIC-0 | done | root `AGENTS.md`, `docs/backlog/**`, `.agents/skills/**` | none |
| W0-S05 | Internal installed-user rehearsal profile registry and no-write preflight | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `apps/cli`, `packages/orchestrator-core` | W0-S02, W0-S03 |
| W0-S06 | Repository CI and acceptance gates | EPIC-0 | done | root CI config, validation scripts, `docs/**`, community health files | W0-S01, W0-S03, W0-S04, W0-S05 |

## W1 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W1-S01 | Bootstrap CLI shell and command contracts | EPIC-6 | done | `apps/cli`, `docs/architecture/14-cli-command-catalog.md`, `docs/contracts/**` | W0-S01, W0-S02 |
| W1-S02 | Project init and profile loading runtime | EPIC-1 | done | `apps/cli`, `packages/contracts`, `packages/orchestrator-core` | W1-S01 |
| W1-S03 | Project analysis engine and durable analysis report | EPIC-1 | done | `packages/orchestrator-core`, `packages/contracts`, `apps/cli` | W1-S02 |
| W1-S04 | Deterministic project validate flow | EPIC-4 | done | `packages/contracts`, `packages/orchestrator-core`, `apps/cli` | W1-S02, W0-S03 |
| W1-S05 | Project verify flow and bounded preflight execution | EPIC-1 | done | `packages/orchestrator-core`, `apps/cli`, `packages/observability` | W1-S03, W1-S04, W0-S05 |
| W1-S06 | Runtime store and artifact packet materialization | EPIC-2 | done | `packages/orchestrator-core`, `packages/contracts`, `apps/cli` | W1-S02 |
| W1-S07 | Wave ticket and handoff packet foundation | EPIC-2 | done | `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**` | W1-S04, W1-S06 |
| W1-S08 | Bootstrap end-to-end rehearsal | EPIC-7 | done | `apps/cli`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability` | W1-S03, W1-S04, W1-S05, W1-S07 |

## W2 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W2-S01 | Route registry and step resolution kernel | EPIC-3 | done | `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/routes/**` | W1-S08 |
| W2-S02 | Wrapper, prompt-bundle, and asset loader runtime | EPIC-3 | done | `packages/orchestrator-core`, `packages/contracts`, `examples/wrappers/**`, `examples/prompts/**` | W2-S01 |
| W2-S03 | Step policy resolution, budgets, and guardrails | EPIC-3 | done | `packages/orchestrator-core`, `docs/contracts/**`, `examples/policies/**` | W2-S01 |
| W2-S04 | Adapter SDK and mock adapter baseline | EPIC-3 | done | `packages/adapter-sdk`, `packages/orchestrator-core`, `examples/adapters/**` | W2-S01 |
| W2-S05 | Routed step execution engine and durable step results | EPIC-3 | done | `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `packages/adapter-sdk` | W2-S02, W2-S03, W2-S04, W1-S06 |
| W2-S06 | First routed execution rehearsal | EPIC-7 | done | `apps/cli`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability` | W2-S05, W1-S07, W0-S05 |

## W3 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W3-S01 | Validation kernel generalization and asset graph checks | EPIC-4 | done | `packages/contracts`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/**` | W2-S05, W1-S04 |
| W3-S02 | Dataset and evaluation suite registry | EPIC-4 | done | `packages/contracts`, `packages/orchestrator-core`, `examples/eval/**` | W3-S01 |
| W3-S03 | Eval runner and scorer interface | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli` | W3-S02, W2-S04, W2-S05 |
| W3-S04 | Harness capture and replay runtime | EPIC-4 | done | `packages/harness`, `packages/observability`, `packages/orchestrator-core` | W3-S02, W2-S05 |
| W3-S05 | Certification and promotion decision baseline | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `apps/cli` | W3-S03, W3-S04 |
| W3-S06 | Quality rehearsal on selected public targets | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/harness`, `apps/cli` | W3-S05, W0-S05 |

## W4 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W4-S01 | Isolated worktree and workspace execution foundation | EPIC-5 | done | `packages/orchestrator-core`, `packages/observability`, `docs/ops/**` | W2-S05, W1-S05 |
| W4-S02 | Delivery planning and write-back mode policy | EPIC-5 | done | `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**` | W4-S01, W1-S07, W3-S05 |
| W4-S03 | Patch and local branch delivery driver | EPIC-5 | done | `packages/orchestrator-core`, `apps/cli`, `packages/observability` | W4-S02 |
| W4-S04 | Fork-first GitHub PR delivery driver | EPIC-5 | done | `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `docs/ops/**` | W4-S02, W2-S04 |
| W4-S05 | Delivery manifest and release packet materialization | EPIC-5 | done | `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**`, `apps/cli` | W4-S03, W4-S04, W3-S05 |
| W4-S06 | Delivery rehearsal and recovery-safe operations | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `apps/cli`, `packages/observability` | W4-S05, W0-S05 |

## W5 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W5-S01 | Control plane API read surface | EPIC-6 | done | `apps/api`, `packages/orchestrator-core`, `packages/contracts` | W4-S05, W2-S05 |
| W5-S02 | Live run event stream | EPIC-6 | done | `apps/api`, `packages/observability`, `docs/contracts/**` | W5-S01, W2-S05 |
| W5-S03 | CLI operator commands beyond bootstrap | EPIC-6 | done | `apps/cli`, `apps/api`, `docs/architecture/**` | W5-S01, W5-S02 |
| W5-S04 | Detachable web UI baseline | EPIC-6 | done | `apps/web`, `apps/api`, `docs/ops/**` | W5-S01, W5-S02 |
| W5-S05 | Standard internal installed-user rehearsal orchestration runner | EPIC-7 | done | `apps/cli`, `apps/api`, `docs/ops/**`, `internal maintainer rehearsal fixtures` | W5-S03, W4-S06, W3-S06 |
| W5-S06 | Scorecards, incident capture, and learning-loop handoff | EPIC-7 | done | `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/backlog/**` | W5-S05, W3-S05 |

## W6 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W6-S01 | Backlog and slice-cycle extensibility for W6+ | EPIC-0 | done | `docs/backlog/**`, `scripts/**` | W5-S06 |
| W6-S02 | Intake/discovery/spec/wave command pack | EPIC-6 | done | `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**` | W6-S01 |
| W6-S03 | Run-control command pack with policy and audit guardrails | EPIC-6 | done | `apps/cli`, `apps/api`, `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**` | W6-S01, W5-S03 |
| W6-S04 | UI attach/detach lifecycle command pack | EPIC-6 | done | `apps/cli`, `apps/web`, `apps/api`, `docs/ops/**` | W6-S03, W5-S04 |
| W6-S05 | Delivery/release prepare command pack | EPIC-5 | done | `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**` | W6-S03, W4-S05 |
| W6-S06 | Incident and audit command pack | EPIC-7 | done | `apps/cli`, `apps/api`, `packages/observability`, `docs/contracts/**`, `docs/ops/**` | W6-S03, W5-S06 |

## W7 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W7-S01 | Governance quality guardrails and evidence parity | EPIC-4 | done | `packages/orchestrator-core`, `packages/harness`, `docs/contracts/**`, `examples/eval/**` | W6-S03, W3-S04 |
| W7-S02 | AI platform promotion/freeze maturity pack | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**` | W7-S01, W3-S05 |
| W7-S03 | Incident recertification and controlled re-enable flow | EPIC-7 | done | `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `docs/ops/**` | W7-S02, W6-S06 |
| W7-S04 | Finance evidence and audit durability expansion | EPIC-7 | done | `packages/observability`, `apps/api`, `docs/contracts/**`, `docs/ops/**` | W6-S06 |
| W7-S05 | MVP+ governance and learning-loop integration closure | EPIC-7 | done | `docs/backlog/**`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability` | W7-S02, W7-S03, W7-S04 |

## W8 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W8-S01 | Sponsor and planner strategic visibility expansion | EPIC-6 | done | `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**` | W7-S05 |
| W8-S02 | Later discovery and architecture maturity pack | EPIC-1 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/product/**` | W6-S02, W7-S05 |
| W8-S03 | Later delivery and security route-governance maturity | EPIC-3 | done | `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/policies/**` | W6-S03, W7-S05, W8-S08 |
| W8-S04 | Later operator event and policy visibility expansion | EPIC-6 | done | `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**` | W6-S03, W7-S05, W8-S08 |
| W8-S05 | Later QA and AI platform baseline comparison maturity | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/eval/**` | W7-S01, W7-S02 |
| W8-S06 | Later incident and platform recertification maturity | EPIC-7 | done | `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**` | W7-S03, W7-S04, W7-S05 |
| W8-S07 | Later multi-repo, bootstrap, and delivery rerun maturity | EPIC-5 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/ops/**` | W6-S05, W6-S02, W8-S04, W8-S06 |
| W8-S08 | Runtime context compiler and adapter-context injection | EPIC-3 | done | `packages/orchestrator-core`, `packages/provider-routing`, `packages/adapter-sdk`, `docs/contracts/**`, `examples/prompts/**` | W6-S03, W7-S05 |
| W8-S09 | Context asset lifecycle and quality-gated update flow | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `apps/cli`, `apps/api`, `docs/contracts/**`, `examples/eval/**` | W8-S08, W7-S02, W8-S05 |

## W9 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W9-S01 | Run-scoped routed evidence durability bugfix | EPIC-3 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**` | W8-S08 |
| W9-S02 | Current-state documentation drift repair | EPIC-0 | done | `README.md`, `docs/architecture/00-repo-layout.md`, `docs/architecture/03-technical-stack.md`, `docs/backlog/**` | none |
| W9-S03 | Control-plane API contract/runtime alignment | EPIC-6 | done | `docs/contracts/control-plane-api.md`, `apps/api`, `apps/web`, `docs/architecture/**` | W8-S04 |
| W9-S04 | Machine-checkable control-plane API contract coverage | EPIC-6 | done | `docs/contracts/control-plane-api.md`, `packages/contracts`, `examples/**`, `apps/api` | W9-S03 |
| W9-S05 | Public harness replay command surface | EPIC-4 | done | `apps/cli`, `packages/orchestrator-core`, `docs/architecture/**`, `docs/ops/**` | W3-S04, W8-S05 |
| W9-S06 | Asset promote/freeze command surface completion | EPIC-4 | done | `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`, `examples/eval/**` | W7-S02, W8-S09 |
| W9-S07 | Detached HTTP control-plane transport baseline | EPIC-6 | done | `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**` | W9-S03, W9-S04 |
| W9-S08 | First real provider adapter and live execution foundation | EPIC-3 | done | `packages/adapter-sdk`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `examples/adapters/**` | W9-S01, W8-S03, W8-S08 |

## W10 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W10-S01 | External live adapter execution baseline | EPIC-3 | done | `packages/adapter-sdk`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `examples/adapters/**`, `docs/ops/**` | W9-S08 |
| W10-S02 | Networked fork-first delivery execution | EPIC-5 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/ops/**` | W4-S04, W6-S05 |
| W10-S03 | Detached transport mutation command baseline | EPIC-6 | done | `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W9-S07, W6-S03, W6-S04 |
| W10-S04 | Detached transport authn/authz hardening baseline | EPIC-6 | done | `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W10-S03 |
| W10-S05 | Externally verified internal installed-user rehearsal target-catalog proof | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `apps/cli`, `packages/observability`, `docs/backlog/**` | W10-S01, W10-S02, W11-S05 |

## W11 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W11-S01 | Source-of-truth reality repair | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**` | none |
| W11-S02 | Target workspace materialization for internal installed-user rehearsal | EPIC-7 | done | `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `internal maintainer rehearsal fixtures`, `docs/ops/**` | W11-S01 |
| W11-S03 | Profile-driven preflight and routed live execution | EPIC-3 | done | `apps/cli`, `packages/adapter-sdk`, `packages/orchestrator-core`, `docs/contracts/**`, `internal maintainer rehearsal fixtures`, `docs/ops/**` | W11-S02 |
| W11-S04 | Target-anchored delivery and release evidence | EPIC-5 | done | `apps/cli`, `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `internal maintainer rehearsal fixtures`, `docs/ops/**` | W11-S03 |
| W11-S05 | Fresh external proof bundle for catalog targets | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability`, `docs/backlog/**` | W11-S04 |

## W12 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W12-S01 | Public surface realignment | EPIC-0 | done | `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**`, `docs/backlog/**` | none |
| W12-S02 | Internal Installed-User Proof Harness | EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability` | W12-S01 |
| W12-S03 | Breaking CLI and contract removal | EPIC-6 | done | `apps/cli`, `docs/contracts/**`, `packages/contracts`, `examples/**` | W12-S02 |
| W12-S04 | Proof refresh after surface cleanup | EPIC-7 | done | `docs/ops/**`, `internal maintainer rehearsal fixtures`, `packages/observability`, `internal maintainer rehearsal tooling` | W12-S03 |

## W13 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W13-S01 | Backlog-first full-journey internal installed-user rehearsal realignment | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**` | none |
| W13-S02 | Curated target and feature mission catalog | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**` | W13-S01 |
| W13-S03 | Public bootstrap and feature-intent intake | EPIC-1 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/product/**` | W13-S02 |
| W13-S04 | Feature-driven discovery and execution lifecycle | EPIC-3 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W13-S03 |
| W13-S05 | Public review and learning-loop closure surfaces | EPIC-4 | done | `apps/cli`, `packages/contracts`, `packages/observability`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W13-S04 |
| W13-S06 | Full-journey proof harness and restored runner skill | EPIC-7 | done | `internal maintainer rehearsal tooling`, `.agents/skills/**`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `apps/cli/test/**` | W13-S05 |

## W14 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W14-S01 | Backlog and source-of-truth realignment | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**` | none |
| W14-S02 | Scenario and provider catalogs | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/contracts/**`, `docs/ops/**` | W14-S01 |
| W14-S03 | Feature-size taxonomy and target mission expansion | EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**` | W14-S02 |
| W14-S04 | Provider-pinned full-journey profiles | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**` | W14-S03 |
| W14-S05 | Proof harness and verdict expansion | EPIC-7 | done | `internal maintainer rehearsal tooling`, `apps/cli`, `packages/orchestrator-core`, `docs/ops/**` | W14-S04 |
| W14-S06 | Review, audit, and closure alignment | EPIC-4 | done | `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api`, `docs/contracts/**`, `docs/architecture/**` | W14-S05 |
| W14-S07 | Proof bundle and skill refresh | EPIC-7 | done | `.agents/skills/**`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `scripts/test/**` | W14-S06 |

## W15 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W15-S01 | Source-of-truth and readiness queue repair | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/ops/**` | none |
| W15-S02 | Package/module workspace alignment | EPIC-0 | done | `apps/**/package.json`, `packages/**/package.json`, `docs/architecture/13-package-and-module-map.md`, `scripts/build.mjs` | W15-S01 |
| W15-S03 | Proof verdict integrity gates | EPIC-7 | done | `scripts/test.mjs`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `README.md` | W15-S01 |

## W16 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W16-S01 | Complexity baseline and shared helper extraction | EPIC-0 | done | `docs/backlog/**`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `apps/api`, test helpers | none |
| W16-S02 | CLI dispatcher decomposition | EPIC-6 | done | `apps/cli` | W16-S01 |
| W16-S03 | API and read-surface decomposition | EPIC-6 | done | `apps/api` | W16-S01 |
| W16-S04 | Orchestrator-core execution decomposition | EPIC-3 | done | `packages/orchestrator-core` | W16-S01 |
| W16-S05 | Installed-user rehearsal runner decomposition | EPIC-7 | done | `internal maintainer rehearsal tooling`, `scripts/test/**` | W16-S01 |
| W16-S06 | Adapter permission legacy removal | EPIC-3 | done | `docs/contracts/**`, `examples/adapters/**`, `packages/adapter-sdk`, `packages/contracts` | W16-S01 |

## W17 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W17-S01 | Legacy surface cleanup after W16 | EPIC-0 | done | `docs/backlog/**`, `apps/cli`, `packages/orchestrator-core`, `internal maintainer rehearsal tooling`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**`, `examples/**`, tests | W16-S02, W16-S04, W16-S05, W16-S06 |

## W18 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W18-S01 | Interactive run continuation contract | EPIC-6 | done | `docs/contracts/**`, `docs/architecture/**`, `docs/product/**`, `docs/backlog/**` | none |
| W18-S02 | Full lifecycle command mutations for connected web | EPIC-6 | done | `apps/api`, `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W18-S01 |
| W18-S03 | Web full-flow operator console | EPIC-6 | done | `apps/web`, `apps/api`, `docs/ops/**`, tests | W18-S02 |
| W18-S04 | Monorepo and bounded multirepo flow proof | EPIC-5 | done | `examples/**`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/product/**`, `docs/ops/**`, tests | none |

## W19 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W19-S01 | User-story registry and coverage evidence matrix | EPIC-0 | done | `docs/product/**`, `docs/backlog/**`, `scripts/test.mjs` | W17-S01 |
| W19-S02 | Product intake source and KPI/DoD model | EPIC-2 | done | `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli` | W19-S01, W13-S03 |
| W19-S03 | Discovery research and ADR evidence flow | EPIC-1 | done | `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli` | W19-S02, W8-S02 |
| W19-S04 | Incident-to-dataset backfill workflow | EPIC-4 | done | `docs/contracts/**`, `packages/harness`, `packages/observability`, `packages/orchestrator-core`, `apps/cli` | W19-S01, W7-S03, W13-S05 |
| W19-S05 | Review decision and approval workflow | EPIC-4 | done | `docs/contracts/**`, `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api` | W19-S01, W13-S05, W14-S06 |
| W19-S06 | Planner metrics and scheduler visibility | EPIC-6 | done | `docs/contracts/**`, `packages/observability`, `apps/api`, `apps/web`, `apps/cli` | W19-S01, W6-S03, W8-S01 |

## W20 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W20-S01 | Multirepo scoped locks and cross-repo validation | EPIC-5 | done | `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, `apps/api`, `docs/ops/**` | W19-S01, W8-S07 |
| W20-S02 | Production security and observability hardening baseline | EPIC-6 | done | `docs/contracts/**`, `docs/architecture/**`, `apps/api`, `apps/web`, `apps/cli`, `packages/observability` | W19-S01, W10-S04 |
| W20-S03 | OpenCode candidate evidence and downgrade follow-up | EPIC-3 | done | `examples/adapters/**`, `packages/adapter-sdk`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**` | W16-S06, W20-S02 |
| W20-S04 | Compiler revision asset lifecycle | EPIC-4 | done | `docs/contracts/**`, `packages/harness`, `packages/orchestrator-core`, `apps/cli`, `apps/api` | W19-S01, W8-S09 |
| W20-S05 | Finance analytics and production monitoring loop | EPIC-7 | done | `docs/contracts/**`, `packages/observability`, `apps/api`, `apps/web`, `apps/cli`, `docs/ops/**` | W20-S02, W7-S04 |

## W21 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W21-S01 | Installed-user onboarding UX contract | EPIC-1 | done | `docs/product/**`, `docs/contracts/**`, `docs/architecture/**`, `docs/backlog/**` | W19-S01 |
| W21-S02 | Installable CLI and first-run entrypoints | EPIC-6 | done | `package.json`, `apps/cli`, `docs/architecture/**`, `docs/ops/**`, tests | W21-S01 |
| W21-S03 | Clean project onboarding and asset-root resolution | EPIC-1 | done | `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, `examples/**`, tests | W21-S01 |
| W21-S04 | Guided mission intake and next-action resolver | EPIC-2 | done | `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, tests | W19-S02, W21-S03 |
| W21-S05 | Guided web app full-flow console | EPIC-6 | done | `apps/web`, `apps/api`, `docs/ops/**`, tests | W18-S03, W21-S04 |
| W21-S06 | Review, delivery, release, and learning closure UX | EPIC-4 | done | `docs/contracts/**`, `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api`, `apps/web`, `docs/ops/**`, tests | W19-S05, W21-S05 |
| W21-S07 | Installed-user guided journey proof | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `apps/cli`, `apps/web`, tests | W21-S02, W21-S03, W21-S04, W21-S05, W21-S06 |

## W22 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W22-S01 | Evidence-strength story coverage model | EPIC-0 | done | `docs/product/**`, `docs/backlog/**`, `scripts/test.mjs` | none |
| W22-S02 | Production readiness source-of-truth | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**` | W22-S01 |
| W22-S03 | OpenCode maturity downgrade | EPIC-3 | done | `examples/adapters/**`, `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**`, `docs/product/**`, contract tests | W22-S01 |

## W23 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W23-S01 | Nested contract validation pack | EPIC-4 | done | `docs/contracts/**`, `packages/contracts/**`, `examples/**`, `scripts/reference-integrity.mjs` | W22-S01 |
| W23-S02 | Explicit production auth scopes | EPIC-6 | done | `apps/api/**`, `apps/cli/**`, `packages/observability/**`, `docs/contracts/control-plane-api.md`, tests | W22-S02 |
| W23-S03 | Shared lifecycle service boundary | EPIC-6 | done | `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, tests, dependency checks | W22-S02 |

## W24 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W24-S01 | Run-level Runtime Harness controller | EPIC-4 | done | `packages/orchestrator-core/**`, `packages/harness/**`, `packages/observability/**`, `apps/cli/**`, tests | W23-S01, W23-S03 |
| W24-S02 | Interactive continuation hardening | EPIC-6 | done | `docs/contracts/**`, `apps/cli/**`, `apps/api/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests | W24-S01, W23-S02 |
| W24-S03 | Strict delivery gate consolidation | EPIC-5 | done | `packages/orchestrator-core/**`, `apps/cli/**`, `docs/contracts/**`, delivery tests | W24-S01, W23-S01 |

## W25 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W25-S01 | Real external-runner proof profile | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, provider catalog tests | W24-S01, W23-S02 |
| W25-S02 | Code-changing full-journey pass | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**` | W25-S01, W24-S03 |
| W25-S03 | Proof fixture and story upgrade | EPIC-7 | done | `internal maintainer rehearsal fixtures`, `docs/product/**`, `scripts/test.mjs`, `docs/ops/**` | W25-S02, W22-S01 |

## W26 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W26-S01 | Production readiness gate | EPIC-0 | done | `scripts/**`, `docs/ops/**`, `docs/backlog/**`, `internal maintainer rehearsal fixtures` | W25-S03, W23-S01, W23-S02, W24-S01 |
| W26-S02 | Maintainability stabilization | EPIC-0 | done | `internal maintainer rehearsal tooling`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, tests | W26-S01 |
| W26-S03 | Self-hosted release documentation | EPIC-7 | done | `README.md`, `docs/ops/**`, `docs/backlog/**`, `docs/product/**` | W26-S01 |

## W27 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W27-S01 | Step-journal observation contract | EPIC-7 | done | `docs/contracts/**`, `packages/contracts/**`, `examples/reports/**` | W26-S03 |
| W27-S02 | Runtime interaction resume | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `apps/web/**`, tests | W27-S01 |
| W27-S03 | Internal installed-user rehearsal step controller output | EPIC-7 | done | `internal maintainer rehearsal tooling`, `scripts/test/**` | W27-S01, W27-S02 |
| W27-S04 | Profile and skill migration | EPIC-7 | done | `.agents/skills/**`, `internal maintainer rehearsal tooling`, `docs/ops/**` | W27-S03 |
| W27-S05 | Legacy cleanup and proof alignment | EPIC-7 | done | `internal maintainer rehearsal fixtures`, `scripts/**`, `docs/product/**`, `docs/backlog/**` | W27-S04 |

## W28 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W28-S01 | AOR install proof and setup journal | EPIC-7 | done | `docs/contracts/**`, `packages/contracts`, `internal maintainer rehearsal tooling`, `examples/reports/**` | W27-S05 |
| W28-S02 | Full-lifecycle and interaction gap closure | EPIC-7 | done | `internal maintainer rehearsal tooling`, `.agents/skills/**`, `docs/ops/**`, tests | W28-S01 |
| W28-S03 | Matrix target expansion | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**` | W28-S01 |

## W29 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W29-S01 | npm CLI alpha release channel | EPIC-5 | done | `package.json`, `.github/workflows/**`, `scripts/**`, `README.md`, `docs/ops/**`, `docs/backlog/**` | W28-S03 |

## W30 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W30-S01 | Post-W29 alpha-hardening planning source of truth | EPIC-0 | done | `docs/backlog/**`, `README.md` | W29-S01 |
| W30-S02 | Alpha architecture decision records | EPIC-0 | done | `docs/architecture/**`, `README.md`, `docs/ops/**`, `docs/contracts/**` | W30-S01 |
| W30-S03 | Machine-readable detached API contract | EPIC-6 | done | `docs/contracts/**`, `examples/control-plane-api/**`, `apps/api/**`, `scripts/**`, tests | W30-S02 |
| W30-S04 | Self-hosted operations hardening docs | EPIC-7 | done | `docs/ops/**`, `SECURITY.md`, `README.md` | W30-S03 |
| W30-S05 | Alpha readiness gate expansion | EPIC-0 | done | `scripts/**`, `docs/ops/**`, `docs/contracts/**`, `docs/product/**`, tests | W30-S04 |
| W30-S06 | Alpha release and onboarding proof refresh | EPIC-5 | done | `docs/ops/**`, `scripts/**`, `docs/product/**`, `package.json`, release tests | W30-S05 |

## W31 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W31-S01 | Installed-user local app launch and onboarding UI | EPIC-6 | done | `apps/web/**`, `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `docs/backlog/**`, `scripts/**`, `package.json` | W30-S06 |

## W32 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W32-S01 | Operator-request interactive runtime flow | EPIC-6 | done | `packages/contracts/**`, `packages/orchestrator-core/**`, `apps/web/**`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `docs/backlog/**`, `examples/**`, `scripts/**` | W31-S01, W24-S02 |

## W33 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W33-S01 | Console flow source-of-truth and static snapshot removal | EPIC-0 | done | `docs/backlog/**`, `README.md`, `docs/architecture/**`, `docs/ops/**`, `docs/product/**`, `apps/web/**`, `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures` | W32-S01 |
| W33-S02 | Reliable root gates and internal installed-user rehearsal timeout bounds | EPIC-0 | done | `scripts/**`, `scripts/test/**`, `docs/backlog/**` | W33-S01 |
| W33-S03 | Failure-safe run start durable state | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/cli/**`, tests | W33-S02 |
| W33-S04 | Guided runtime-root fidelity | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/cli/**`, tests, docs | W33-S02 |
| W33-S05 | Control-plane launch and port guidance alignment | EPIC-6 | done | `apps/cli/**`, `packages/orchestrator-core/**`, `docs/ops/**`, tests | W33-S04 |
| W33-S06 | App-smoke console boundary and static snapshot removal | EPIC-6 | done | `apps/web/**`, `apps/cli/**`, `internal maintainer rehearsal tooling`, `docs/ops/**`, tests | W33-S02 |
| W33-S07 | CLI operator output ergonomics | EPIC-6 | done | `apps/cli/**`, `packages/orchestrator-core/**`, `docs/architecture/**`, tests | W33-S04 |
| W33-S08 | Control-plane OpenAPI payload schema depth | EPIC-6 | done | `docs/contracts/**`, `examples/control-plane-api/**`, `apps/api/**`, `scripts/**`, tests | W33-S02 |
| W33-S09 | Runtime read-model scale and pagination baseline | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, tests | W33-S02 |
| W33-S10 | Web app smoke module cleanup and console surface simplification | EPIC-6 | done | `apps/web/**`, tests | W33-S06 |

## W34 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W34-S01 | Flow product and contract baseline | EPIC-6 | done | `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `examples/**`, `docs/backlog/**` | W33-S10, W32-S01, W21-S07 |
| W34-S02 | Runtime and control-plane flow projections | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `docs/contracts/**`, `examples/control-plane-api/**`, tests | W34-S01 |
| W34-S03 | Flow-first local web shell | EPIC-6 | done | `apps/web/**`, `apps/cli/**`, `docs/product/assets/w34-flow-centric-console/**`, tests | W34-S02 |
| W34-S04 | Flow-scoped evidence, trace, and interaction workbench | EPIC-6 | done | `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/contracts/**`, tests | W34-S02 |
| W34-S05 | Closure-to-new-flow UX | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/web/**`, `docs/product/**`, `docs/contracts/**`, tests | W34-S02 |
| W34-S06 | Installed-user browser-task flow-loop proof | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `apps/web/**`, `apps/cli/**`, tests | W34-S03, W34-S04, W34-S05 |
| W34-S07 | Backlog, docs, and release-gate alignment | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**`, `scripts/**`, release tests | W34-S06 |

## W35 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W35-S01 | Provider heartbeat and long-running step status | EPIC-6 | done | `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `apps/web/**`, `internal maintainer rehearsal tooling`, tests | W34-S07 |
| W35-S02 | User-facing artifact reference renderer | EPIC-6 | done | `docs/contracts/**`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, `examples/control-plane-api/**`, tests | W35-S01 |
| W35-S03 | Operator decision helper and decision UX | EPIC-7 | done | `internal maintainer rehearsal tooling`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, `docs/ops/**`, tests | W35-S02 |
| W35-S04 | Execution evidence panel and interruption controls | EPIC-6 | done | `apps/web/**`, `apps/api/**`, `apps/cli/**`, `packages/orchestrator-core/**`, `internal maintainer rehearsal tooling`, `docs/contracts/**`, tests | W35-S01, W35-S02, W35-S03 |
| W35-S05 | Codex/Qwen internal installed-user rehearsal UX proof and runbook closure | EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `apps/web/**`, `apps/cli/**`, tests | W35-S04 |

## W36 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W36-S01 | No-settings onboarding and workspace contract baseline | EPIC-1 | done | `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/backlog/**` | W35-S04 |
| W36-S02 | App workspace and project registry | EPIC-6 | done | `packages/orchestrator-core/**`, `apps/api/**`, `docs/contracts/**`, tests | W36-S01 |
| W36-S03 | First-run onboarding wizard | EPIC-6 | done | `apps/web/**`, `packages/orchestrator-core/**`, tests | W36-S02 |
| W36-S04 | Local multi-project switcher UX | EPIC-6 | done | `apps/web/**`, `packages/orchestrator-core/**`, tests | W36-S03 |
| W36-S05 | Docs, smoke, and proof | EPIC-7 | done | `README.md`, `docs/ops/**`, `apps/web/**`, `packages/orchestrator-core/**`, `scripts/**`, tests | W36-S04 |
| W37-S01 | Internal installed-user rehearsal target setup and verification closure | EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, tests | W35-S04 |
| W38-S01 | Qwen stream progress adapter closure | EPIC-6, EPIC-7 | done | `docs/contracts/**`, `examples/adapters/**`, `packages/adapter-sdk/**`, `packages/orchestrator-core/**`, `apps/web/**`, `internal maintainer rehearsal tooling`, tests | W35-S05, W37-S01 |
| W39-S01 | Internal installed-user rehearsal provider parity policy | EPIC-7 | done | `internal maintainer rehearsal tooling`, `packages/orchestrator-core/**`, `docs/ops/**`, tests | W38-S01 |

## W40 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W40-S01 | Post-alpha.7 backlog and product baseline | EPIC-0 | done | `docs/backlog/**`, `docs/product/**`, `docs/ops/**` | W39-S01, W36-S05 |
| W40-S02 | Installed-user onboarding and release docs hardening | EPIC-1, EPIC-6 | done | `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests | W40-S01 |
| W40-S03 | Active internal installed-user rehearsal heartbeat surfacing | EPIC-6, EPIC-7 | done | `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, `internal maintainer rehearsal tooling`, `docs/contracts/**`, tests | W40-S01, W35-S01, W38-S01, W39-S01 |
| W40-S04 | Optional provider qualification matrix | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `docs/product/**`, tests | W40-S03, W39-S01 |

## W41 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W41-S01 | Post-alpha.8 backlog and validation baseline | EPIC-0 | done | `docs/backlog/**`, `README.md` | W40-S04 |
| W41-S02 | Alpha.8 installed-user onboarding smoke refresh | EPIC-1, EPIC-6 | done | `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests | W41-S01 |
| W41-S03 | Alpha.8 provider qualification smoke refresh | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `docs/product/**`, tests | W41-S02, W40-S04 |
| W41-S04 | Alpha.8 findings closure and next-release decision | EPIC-0, EPIC-6 | done | `docs/backlog/**`, `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, tests | W41-S02, W41-S03 |

## W42 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W42-S01 | Alpha.9 release prep for W41 fixes | EPIC-5 | done | `package.json`, `README.md`, `CHANGELOG.md`, `docs/ops/**`, release tests | W41-S04 |
| W42-S02 | Operator interruption owner classification cleanup | EPIC-6, EPIC-7 | done | `docs/contracts/**`, `packages/orchestrator-core/**`, `internal maintainer rehearsal tooling`, `apps/web/**`, `docs/ops/**`, tests | W42-S01 |

## W43 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W43-S01 | Post-alpha.10 backlog and confidence baseline | EPIC-0 | done | `docs/backlog/**`, `README.md` | W42-S02 |
| W43-S02 | Alpha.10 installed-user onboarding and evidence smoke | EPIC-1, EPIC-6 | done | `README.md`, `docs/ops/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, tests | W43-S01 |
| W43-S03 | Alpha.10 internal installed-user rehearsal interruption and provider smoke | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, `apps/web/**`, tests | W43-S02 |
| W43-S04 | Alpha.10 findings closure and next-release decision | EPIC-0, EPIC-6 | done | `docs/backlog/**`, `README.md`, `docs/ops/**`, tests | W43-S02, W43-S03 |

## W44 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W44-S01 | Artifact workflow taxonomy and transition invariants | EPIC-0, EPIC-3 | done | `docs/architecture/**`, `docs/contracts/**`, `docs/backlog/**`, `examples/**` | W43-S04 |
| W44-S02 | Discovery/research/spec prompt bundle split | EPIC-3 | done | `examples/prompts/**`, `examples/project*.aor.yaml`, `packages/contracts/**`, `packages/orchestrator-core/**`, tests | W44-S01 |
| W44-S03 | Artifact readiness state machine and stale transitions | EPIC-1, EPIC-6 | done | `docs/contracts/**`, `packages/orchestrator-core/**`, `apps/cli/**`, `apps/api/**`, `apps/web/**`, `examples/reports/**`, tests | W44-S02 |
| W44-S04 | Context, skill, and policy overlays from evidence | EPIC-4, EPIC-3 | done | `examples/context/**`, `examples/skills/**`, `examples/policies/**`, `packages/orchestrator-core/**`, `packages/contracts/**`, `docs/architecture/**`, tests | W44-S02, W44-S03 |
| W44-S05 | Post-implementation docs and internal installed-user rehearsal validation | EPIC-0, EPIC-7 | done | `README.md`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `internal maintainer rehearsal fixtures`, `internal maintainer rehearsal tooling`, tests | W44-S04 |

## W45 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W45-S01 | Quality repair request contract and operating model | EPIC-4 | done | `docs/contracts/**`, `docs/architecture/**`, `examples/reports/**`, `examples/project.aor.yaml`, `docs/backlog/**` | W44-S05 |
| W45-S02 | Cross-stage repair state machine and next-action resolver | EPIC-4, EPIC-6 | done | `packages/orchestrator-core/**`, `packages/observability/**`, `packages/contracts/**`, tests | W45-S01 |
| W45-S03 | CLI and control-plane quality repair surfaces | EPIC-6 | done | `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/contracts/control-plane-api.md`, `examples/control-plane-api/**`, tests | W45-S02 |
| W45-S04 | Web repair-cycle observability | EPIC-6 | done | `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/product/**`, tests | W45-S03 |
| W45-S05 | Repair-loop proof fixtures and internal profile | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, `docs/ops/**`, tests | W45-S02, W45-S03, W45-S04 |
| W45-S06 | Documentation refresh and internal installed-user rehearsal acceptance | EPIC-7, EPIC-0 | done | `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `docs/product/**`, `docs/backlog/**`, `README.md`, `internal maintainer rehearsal tooling`, `internal maintainer rehearsal fixtures`, tests | W45-S05 |

## W46 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W46-S01 | Contract/docs breaking policy | EPIC-0, EPIC-7 | done | `docs/contracts/**`, `docs/ops/**`, `packages/contracts/**` | W43-S04 |
| W46-S02 | Step evaluator report and runner behavior | EPIC-7 | done | `internal maintainer rehearsal tooling`, `packages/orchestrator-core/**`, `scripts/test/**` | W46-S01 |
| W46-S03 | Catalog budget and small-canary migration | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**` | W46-S01 |
| W46-S04 | Product-change mission rewrite for current targets | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**` | W46-S03 |
| W46-S05 | Hard target expansion | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**` | W46-S04 |
| W46-S06 | Proof-complete acceptance closure and findings intake | EPIC-0, EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**`, root checks | W46-S05 |

## W47 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W47-S01 | AOR operator keyboard accessibility and guided proof closure | EPIC-6, EPIC-7 | done | `apps/web/**`, `internal maintainer rehearsal tooling`, tests | W46-S06 |
| W47-S02 | Internal installed-user rehearsal target verification isolation and Vitest readiness | EPIC-7 | done | `internal maintainer rehearsal tooling`, `packages/orchestrator-core/**`, target catalog/profile docs, tests | W47-S01 |
| W47-S03 | AOR repair/review convergence hardening | EPIC-4, EPIC-7 | done | `internal maintainer rehearsal tooling`, `packages/orchestrator-core/**`, review/repair docs, tests | W47-S02 |
| W47-S04 | Full proof rerun and product acceptance closure | EPIC-0, EPIC-7 | done | `internal maintainer rehearsal tooling`, `docs/ops/**`, root checks | W47-S03 |

## W48 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W48-S01 | Quality-cycle contract and profile policy | EPIC-0, EPIC-7 | done | `docs/contracts/**`, `docs/ops/**`, `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, tests | W47-S04 |
| W48-S02 | Quality-cycle runner and controller implementation | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `scripts/test/**` | W48-S01 |
| W48-S03 | Structured repair context and convergence classification | EPIC-4, EPIC-6, EPIC-7 | done | `docs/contracts/review-decision.md`, `packages/contracts/**`, `packages/observability/**`, `packages/orchestrator-core/**`, tests | W48-S02 |
| W48-S04 | Vitest target toolchain policy | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, tests | W48-S03 |
| W48-S05 | Control quality-cycle proof rerun and product acceptance closure | EPIC-0, EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer runbook`, root checks, internal proof runs | W48-S04 |

## W49 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W49-S01 | Proof findings hygiene and evidence truthfulness | EPIC-0, EPIC-7 | done | `internal maintainer runbook`, `docs/backlog/**` | W48-S04 |
| W49-S02 | Repeated repair anti-loop enforcement | EPIC-4, EPIC-7 | done | `docs/contracts/review-decision.md`, `packages/contracts/**`, `packages/observability/**`, `internal maintainer rehearsal tooling`, tests | W49-S01 |
| W49-S03 | QA-specific step-quality evaluator hardening | EPIC-4, EPIC-7 | done | `internal maintainer contract doc`, `packages/contracts/**`, `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, tests | W49-S02 |
| W49-S04 | Full Control internal installed-user rehearsal rerun and product acceptance closure | EPIC-0, EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer runbook`, root checks, internal proof runs | W49-S03 |

## W50 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W50-S01 | Review verification mapping and residual-risk classification | EPIC-4, EPIC-7 | done | `docs/contracts/review-report.md`, `packages/contracts/**`, `packages/orchestrator-core/src/review-run.mjs`, tests | W49-S04 |
| W50-S02 | Internal installed-user rehearsal target toolchain fail-fast and setup-journal hygiene | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, runner tests | W50-S01 |
| W50-S03 | Fastify/Vitest control rerun and product acceptance closure | EPIC-0, EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer runbook`, root checks, internal proof runs | W50-S02 |
| W50-S04 | Findings/backlog state sync | EPIC-0, EPIC-7 | done | `docs/backlog/**`, `internal maintainer runbook` | W50-S03 |

## W51 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W51-S01 | Clean-commit W50 proof rerun | EPIC-0, EPIC-7 | done | `internal maintainer runbook`, `internal maintainer rehearsal tooling`, root checks, live proof artifacts | W50-S04 |
| W51-S02 | Vitest compatible Node large acceptance | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `internal maintainer runbook` | W51-S01 |
| W51-S03 | Automated final quality report hydration | EPIC-4, EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `packages/contracts/**`, tests | W51-S02 |
| W51-S04 | Explicit target-readiness phase | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, contracts/docs/tests | W51-S03 |
| W51-S05 | Next hard-target expansion after large acceptance | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, `docs/ops/**`, `docs/backlog/**` | W51-S04 |

## W52 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W52-S01 | Target-readiness owner propagation | EPIC-7 | done | `internal maintainer rehearsal tooling`, `internal maintainer rehearsal tooling`, run-health examples/tests | W51-S05 |
| W52-S02 | Diagnostic command hang and timeout hardening | EPIC-4, EPIC-7 | done | `packages/orchestrator-core/**`, `internal maintainer rehearsal tooling`, verification tests | W52-S01 |
| W52-S06 | Codex provider tool-surface hardening | EPIC-7 | done | `examples/adapters/codex-cli.yaml`, `packages/adapter-sdk/**`, live adapter/run-health tests | W52-S02 |
| W52-S07 | Manual xlarge step-quality continuation | EPIC-7 | done | `scripts/live-e2e/manual-live-e2e.mjs`, step-quality contracts, controller tests | W52-S02 |
| W52-S03 | Vitest large product acceptance closure | EPIC-7 | done | `internal maintainer rehearsal tooling`, target catalog, proof findings | W52-S02, W52-S06, W52-S07 |
| W52-S04 | SQLAlchemy large diagnostic policy and acceptance closure | EPIC-7 | done | `internal maintainer rehearsal tooling`, target catalog, quality reports | W52-S02, W52-S06, W52-S07 |
| W52-S05 | Hard-target proof rerun and findings sync | EPIC-0, EPIC-7 | done | `internal maintainer runbook`, backlog docs, root checks, proof artifacts | W52-S03, W52-S04 |
| W52-S08 | Manual step-quality assessment depth | EPIC-4, EPIC-7 | done | `scripts/live-e2e/lib/step-quality-assessment.mjs`, `scripts/live-e2e/manual-live-e2e.mjs`, step-quality contracts/tests | W52-S05 |
| W52-S09 | Diagnostic command classification precision | EPIC-4, EPIC-7 | done | `scripts/live-e2e/lib/flows.mjs`, `scripts/live-e2e/run-profile.mjs`, run-health contracts/tests | W52-S05 |
| W52-S10 | Acceptance evidence matrix and xlarge observation reporting | EPIC-0, EPIC-7 | done | `scripts/live-e2e/**`, `scripts/live-e2e/docs/runbooks/live-e2e-proof-complete-findings.md`, backlog docs | W52-S08, W52-S09 |

## W53 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W53-S01 | Generic verification command-group contract | EPIC-4, EPIC-7 | done | `docs/contracts/**`, `packages/contracts/**`, examples | W52-S10 |
| W53-S02 | AOR project verify command-group execution | EPIC-4 | done | `packages/orchestrator-core/src/project-verify.mjs`, verifier tests | W53-S01 |
| W53-S03 | Live E2E adapter boundary mapping | EPIC-7 | done | `scripts/live-e2e/lib/**`, live E2E docs/tests | W53-S02 |
| W53-S04 | AOR/live E2E leak guards | EPIC-0, EPIC-7 | done | `packages/**`, `apps/**`, boundary tests | W53-S03 |
| W53-S05 | Generic verification archetype fixtures | EPIC-4, EPIC-7 | done | verifier tests | W53-S04 |

## W54 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W54-S01 | Verification group authoring contract | EPIC-4, EPIC-7 | done | `docs/contracts/**`, `packages/contracts/**`, examples | W53-S05 |
| W54-S02 | Stack discovery engine | EPIC-1, EPIC-4 | done | `packages/orchestrator-core/**`, discovery fixtures, tests | W54-S01 |
| W54-S03 | Project init profile materialization | EPIC-1 | done | `packages/orchestrator-core/src/project-init.mjs`, examples, init tests | W54-S02 |
| W54-S04 | Verifier execution semantics hardening | EPIC-4 | done | `packages/orchestrator-core/src/project-verify.mjs`, verifier tests | W54-S03 |
| W54-S05 | CLI/API/UI verification plan surfaces | EPIC-6 | done | `apps/cli/**`, `apps/api/**`, `apps/web/**`, `packages/orchestrator-core/**` | W54-S04 |
| W54-S06 | Migration and examples | EPIC-4 | done | `docs/contracts/**`, `docs/ops/**`, `examples/**`, CLI tests | W54-S05 |
| W54-S07 | Real archetype smoke matrix | EPIC-4, EPIC-7 | done | verifier fixtures, smoke tests, docs | W54-S06 |
| W54-S08 | Boundary regression expansion | EPIC-0, EPIC-7 | done | boundary tests, public docs/examples, artifact fixtures | W54-S07 |

## W55 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W55-S01 | Backlog intake and control finding disposition | EPIC-0, EPIC-7 | done | `docs/backlog/**`, `README.md` | W54-S08 |
| W55-S02 | Actionable verification failure repair evidence | EPIC-4, EPIC-7 | done | `docs/contracts/**`, `packages/orchestrator-core/src/review-run.mjs`, `packages/adapter-sdk/**`, tests | W55-S01 |
| W55-S03 | `ky` xlarge primary verification alignment | EPIC-7 | done | `scripts/live-e2e/catalog/targets/ky.yaml`, generated profile tests, runbook docs | W55-S02 |
| W55-S04 | Claude xlarge context guardrails | EPIC-7 | done | `examples/adapters/claude-code.yaml`, `packages/adapter-sdk/**`, adapter tests, provider runbooks | W55-S03 |
| W55-S05 | Control rerun and findings report | EPIC-0, EPIC-7 | done | `docs/backlog/**`, `docs/ops/**`, internal live E2E run artifacts | W55-S04 |

## W56 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W56-S01 | First-run console focus and action clarity | EPIC-1, EPIC-6 | done | `apps/web/**`, `docs/backlog/**`, `README.md`, tests | W55-S05 |
| W56-S02 | Rendered cockpit UX hardening | EPIC-1, EPIC-6 | done | `apps/web/**`, `docs/backlog/**`, tests | W56-S01 |
| W56-S03 | Rendered UX audit closure | EPIC-1, EPIC-6 | done | `apps/web/**`, `docs/backlog/**`, tests | W56-S02 |

## W57 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W57-S01 | Audit disposition, release hold, and local-app threat model | EPIC-0, EPIC-6 | done | architecture/contracts/ops docs, README, production-readiness gate | W56-S03 |
| W57-S09 | Complete test discovery and deterministic safety-gate baseline | EPIC-0 | done | root test discovery, readiness/CI/release gates, dependency baseline | W57-S01 |
| W57-S02 | Canonical identifier, path, and mission-scope contracts | EPIC-1, EPIC-2, EPIC-3, EPIC-5 | done | `docs/contracts/**`, `packages/contracts/**`, examples/tests | W57-S09 |
| W57-S03 | True workspace isolation and no-write enforcement | EPIC-1, EPIC-3, EPIC-5 | done | workspace isolation, step execution, delivery plan, adapter SDK | W57-S02 |
| W57-S04 | Structural runtime permission enforcement | EPIC-3 | done | permission contracts/policy, step execution, adapter tests | W57-S02, W57-S03 |
| W57-S05 | Exact-diff delivery and resolvable authorization evidence | EPIC-4, EPIC-5 | done | delivery/Harness contracts, delivery runtime, CLI/tests | W57-S02, W57-S03, W57-S04 |
| W57-S06 | Transactional initialization and runtime-root containment | EPIC-1, EPIC-2 | done | project init, artifact store, asset roots, tests | W57-S02 |
| W57-S07 | Atomic attempts, run control, and event identity | EPIC-2, EPIC-3, EPIC-6 | done | attempt/result store, run control, observability journal | W57-S06 |
| W57-S10 | Project-anchored command and evidence resolution | EPIC-1, EPIC-2, EPIC-6 | done | project context, control-plane handlers, evidence/path resolution, package/browser tests | W57-S02, W57-S06 |
| W57-S08 | Trust-boundary regression proof and release disposition | EPIC-0, EPIC-7 | ready | root gates, safety fixtures, package smoke, audit ledger | W57-S03, W57-S04, W57-S05, W57-S06, W57-S07, W57-S10 |

## W58 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W58-S01 | Non-materializing read-model contract and runtime | EPIC-1, EPIC-6 | blocked | control-plane contract, read services/handlers, CLI/API/web fixtures | W57-S08 |
| W58-S02 | Effective context and unique asset identity | EPIC-1, EPIC-3, EPIC-4 | blocked | asset/context contracts, registry/compiler, adapter SDK | W57-S08 |
| W58-S03 | Executable route fallback, retry, repair, and adapter semantics | EPIC-3, EPIC-4, EPIC-7 | blocked | route/policy contracts, provider routing, step execution, adapters | W57-S08 |
| W58-S04 | Real evaluation, Harness lineage, and replay compatibility | EPIC-4 | blocked | eval/Harness contracts, scorer, certification, replay | W57-S05, W58-S02, W58-S03 |
| W58-S05 | Asynchronous run jobs and durable live-event delivery | EPIC-3, EPIC-6 | blocked | lifecycle worker, process supervision, journal, SSE/CLI follow | W57-S08 |
| W58-S06 | Canonical API, OpenAPI, CLI, and service boundary | EPIC-0, EPIC-6 | blocked | API/CLI/control-plane services, OpenAPI, readiness tests | W58-S01, W58-S05 |
| W58-S07 | Loopback-only local app transport boundary | EPIC-6 | blocked | local-console ADR, app launcher, HTTP transport/config/tests | W58-S01, W58-S06 |
| W58-S08 | Runtime-quality acceptance proof | EPIC-0, EPIC-7 | blocked | integration proof, package smoke, audit/readiness evidence | W58-S02, W58-S03, W58-S04, W58-S05, W58-S06, W58-S07 |

## W59 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W59-S01 | Executable browser and component behavior gate | EPIC-0, EPIC-6, EPIC-7 | blocked | web browser/component tests, package smoke, CI | W58-S08 |
| W59-S02 | Local console live-state and interaction correctness | EPIC-1, EPIC-6 | blocked | web client/state/queues, shared read models, fixtures | W59-S01 |
| W59-S03 | Accessible local dialogs and web state decomposition | EPIC-0, EPIC-6 | blocked | web components/styles/state modules, browser tests | W59-S01, W59-S02 |
| W59-S04 | Code-quality, dependency, and dead-code ratchet | EPIC-0 | blocked | root quality gates, ESLint/typecheck, dependency/dead-code baselines | W58-S08 |
| W59-S05 | Core, CLI, and control-plane decomposition | EPIC-0, EPIC-3, EPIC-6 | blocked | execution services, CLI handlers, lifecycle/control-plane modules | W58-S08, W59-S04 |
| W59-S06 | Adapter/live-E2E decomposition and contract-kernel parity | EPIC-0, EPIC-3, EPIC-4, EPIC-7 | blocked | adapter SDK, live E2E stages, public/private contract kernels | W58-S08, W59-S04 |
| W59-S07 | Independent audit closure and readiness decision | EPIC-0, EPIC-5, EPIC-7 | blocked | audit ledger/report, story/readiness/release sources, full gates | W59-S02, W59-S03, W59-S04, W59-S05, W59-S06 |

## W60 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W60-S01 | Structured task contract and backlog detail baseline | EPIC-0, EPIC-2, EPIC-4 | blocked | `docs/product/**`, `docs/contracts/**`, `docs/backlog/**`, `packages/contracts/**`, `examples/packets/**`, `.agents/skills/backlog-workflow/**`, tests | W59-S07 |
| W60-S02 | Planner decomposition and task quality gate | EPIC-2, EPIC-3, EPIC-4 | blocked | `examples/prompts/**`, `examples/context/**`, `packages/orchestrator-core/src/handoff-packets.mjs`, `packages/contracts/**`, planning tests | W60-S01, W44-S03 |
| W60-S03 | Execution plan and evidence-derived task progress | EPIC-2, EPIC-3, EPIC-6 | blocked | `docs/contracts/**`, `packages/contracts/**`, `packages/orchestrator-core/**`, `packages/observability/**`, `examples/reports/**`, tests | W60-S02 |
| W60-S04 | Plan workbench UX and approval flow | EPIC-6 | blocked | `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/product/**`, control-plane tests | W60-S03 |
| W60-S05 | Structured planning proof and documentation closure | EPIC-0, EPIC-7 | blocked | `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`, `scripts/live-e2e/**`, root checks | W60-S04 |

## W61 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W61-S01 | Project topology and local binding contract baseline | EPIC-1, EPIC-2, EPIC-5 | blocked | `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `examples/project*.aor.yaml`, `packages/contracts/**`, tests | W60-S01 |
| W61-S02 | Persistent local workspace registry and topology discovery | EPIC-1, EPIC-6 | blocked | `packages/orchestrator-core/**`, `apps/cli/**`, `apps/api/**`, local registry and project-analysis tests | W61-S01 |
| W61-S03 | Project topology CLI/API management and validation | EPIC-1, EPIC-6 | blocked | `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/contracts/control-plane-api.md`, OpenAPI/examples, tests | W61-S02 |
| W61-S04 | Add Project and Project Structure UX | EPIC-6 | blocked | `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/product/**`, browser tests | W61-S03 |
| W61-S06 | Project execution profile and runner-readiness contract | EPIC-1, EPIC-3, EPIC-6 | blocked | execution-profile/readiness contracts, project profile, provider routing, CLI/API/control plane, tests | W61-S03 |
| W61-S07 | Execution Setup UX and browser proof | EPIC-1, EPIC-6 | blocked | `apps/web/**`, control-plane client, execution setup/readiness projections, browser/accessibility tests | W61-S04, W61-S06 |
| W61-S05 | Topology onboarding proof and documentation closure | EPIC-0, EPIC-7 | blocked | `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`, `scripts/live-e2e/**`, root checks | W61-S07 |

## W62 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W62-S01 | Workspace-set provisioner and repository change evidence | EPIC-3, EPIC-5 | blocked | `docs/contracts/**`, `packages/orchestrator-core/**`, `packages/contracts/**`, workspace and Git tests | W61-S03, W4-S01 |
| W62-S02 | Impact scope and execution DAG planning | EPIC-2, EPIC-3, EPIC-4 | blocked | `docs/contracts/**`, `packages/orchestrator-core/**`, `packages/contracts/**`, `examples/packets/**`, planner/scope tests | W60-S03, W61-S03 |
| W62-S03 | Parent/child Runtime Harness scheduler and bounded concurrency | EPIC-3, EPIC-4, EPIC-6 | blocked | `packages/orchestrator-core/**`, `packages/observability/**`, `apps/cli/**`, `apps/api/**`, scheduler tests | W62-S01, W62-S02, W24-S01 |
| W62-S04 | Integration, stale-task invalidation, and bounded repair | EPIC-4, EPIC-5, EPIC-6 | blocked | `packages/orchestrator-core/**`, `packages/observability/**`, `docs/contracts/**`, integration/repair tests | W62-S03, W45-S02 |
| W62-S05 | Coordinated delivery and execution UX | EPIC-5, EPIC-6 | blocked | `apps/web/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/contracts/**`, `docs/product/**`, tests | W62-S04, W20-S01, W24-S03 |
| W62-S06 | Monorepo and bounded multirepo full-flow proof | EPIC-0, EPIC-7 | blocked | `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `examples/live-e2e/**`, `scripts/live-e2e/**`, root checks | W62-S05, W60-S05, W61-S05 |

## W63 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W63-S01 | Operator journey, action semantics, and scenario baseline | EPIC-0, EPIC-6 | blocked | product/architecture/contracts docs, web scenario fixtures | W62-S06 |
| W63-S02 | Semantic design system and component contracts | EPIC-0, EPIC-6 | blocked | `apps/web/src/**`, UI foundation docs/tests | W63-S01 |
| W63-S03 | Guided Mission intake and resumable first-flow creation | EPIC-1, EPIC-2, EPIC-6 | blocked | intake/scope contracts, Mission UI, lifecycle responses, browser tests | W63-S01, W63-S02 |
| W63-S04 | Truthful action-first cockpit and recovery controls | EPIC-3, EPIC-4, EPIC-6 | blocked | next-action/control-plane contracts, cockpit/recovery UI, browser tests | W63-S01, W63-S02 |
| W63-S05 | Adaptive shell and lifecycle navigation | EPIC-6 | blocked | app shell, responsive navigation, accessibility/browser tests | W63-S03, W63-S04 |
| W63-S06 | Attention queue, evidence workbench, and cockpit hierarchy | EPIC-1, EPIC-4, EPIC-6 | blocked | queue/workbench projections, responsive UI, browser tests | W63-S03, W63-S04, W63-S05 |
| W63-S07 | Installed-console UX/UI acceptance | EPIC-0, EPIC-6, EPIC-7 | blocked | installed SPA proof, accessibility, visual/browser evidence, docs | W63-S02, W63-S03, W63-S04, W63-S05, W63-S06 |
| W63-S08 | Browser-operable canonical lifecycle parity | EPIC-0, EPIC-3, EPIC-4, EPIC-6, EPIC-7 | blocked | canonical lifecycle actions, installed SPA full-flow proof, durable readback, story closure | W63-S07 |

## W64 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W64-S01 | Idempotent alpha publish transaction and partial-failure recovery | EPIC-0, EPIC-5 | blocked | release workflow/state inspection, release tests, npm alpha runbook | W29-S01, W59-S07 |
| W64-S02 | Verification-to-delivery transaction decomposition | EPIC-0, EPIC-5 | blocked | project verification, delivery plan/driver, fork-first flow, characterization tests | W59-S07 |
| W64-S03 | Operator decision projection decomposition | EPIC-0, EPIC-4, EPIC-6 | blocked | next-action/read projections, asset certification, golden fixtures | W59-S07 |

## W65 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W65-S01 | Cutover contract, parity baseline, and migration ledger | EPIC-0, EPIC-6 | blocked | product/contract docs, W63 scenarios, selector/app-config compatibility, parity fixtures | W63-S08 |
| W65-S02 | Reversible experience selector and navigation compatibility | EPIC-0, EPIC-6 | blocked | shared web bootstrap/client/action boundary, selector/navigation fixtures, packaged assets | W65-S01 |
| W65-S03 | Mission and Quiet Cockpit pilot activation | EPIC-1, EPIC-2, EPIC-6 | blocked | Mission/Cockpit pilot scenarios, canonical mutations, browser/a11y/durable readback | W65-S02 |
| W65-S04 | Attention, Journey, and Evidence pilot activation | EPIC-2, EPIC-3, EPIC-4, EPIC-6 | blocked | specialist modes, W60-W62 projections, evidence/trace reads, comparison fixtures | W65-S02 |
| W65-S05 | Default-on cutover and explicit rollback rehearsal | EPIC-0, EPIC-6 | blocked | app-config/default resolution, installed package proof, rollback runbook | W65-S03, W65-S04 |
| W65-S06 | Legacy console retirement and compatibility cleanup | EPIC-0, EPIC-6 | blocked | legacy web source/CSS/fixtures, selector compatibility, packaged assets | W65-S05 |
| W65-S07 | Post-cutover installed-console acceptance and story closure | EPIC-0, EPIC-6, EPIC-7 | blocked | installed browser proof, guided profile, a11y/comparison evidence, product/story/runbook docs | W65-S06 |

## Planning note
Every wave document includes a starter local-task outline for each slice. New
medium+ slices carry Purpose, concrete Changes, and Validation for each work
package. Agents should normally implement one slice at a time and refine only
the local tasks inside that slice unless the shared backlog truly needs a new
independently acceptable outcome.
