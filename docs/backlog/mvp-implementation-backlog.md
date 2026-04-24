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
| W0-S05 | Live E2E profile registry and no-write preflight | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/orchestrator-core` | W0-S02, W0-S03 |
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
| W1-S08 | Bootstrap end-to-end rehearsal | EPIC-7 | done | `apps/cli`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability` | W1-S03, W1-S04, W1-S05, W1-S07 |

## W2 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W2-S01 | Route registry and step resolution kernel | EPIC-3 | done | `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/routes/**` | W1-S08 |
| W2-S02 | Wrapper, prompt-bundle, and asset loader runtime | EPIC-3 | done | `packages/orchestrator-core`, `packages/contracts`, `examples/wrappers/**`, `examples/prompts/**` | W2-S01 |
| W2-S03 | Step policy resolution, budgets, and guardrails | EPIC-3 | done | `packages/orchestrator-core`, `docs/contracts/**`, `examples/policies/**` | W2-S01 |
| W2-S04 | Adapter SDK and mock adapter baseline | EPIC-3 | done | `packages/adapter-sdk`, `packages/orchestrator-core`, `examples/adapters/**` | W2-S01 |
| W2-S05 | Routed step execution engine and durable step results | EPIC-3 | done | `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `packages/adapter-sdk` | W2-S02, W2-S03, W2-S04, W1-S06 |
| W2-S06 | First routed execution rehearsal | EPIC-7 | done | `apps/cli`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability` | W2-S05, W1-S07, W0-S05 |

## W3 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W3-S01 | Validation kernel generalization and asset graph checks | EPIC-4 | done | `packages/contracts`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/**` | W2-S05, W1-S04 |
| W3-S02 | Dataset and evaluation suite registry | EPIC-4 | done | `packages/contracts`, `packages/orchestrator-core`, `examples/eval/**` | W3-S01 |
| W3-S03 | Eval runner and scorer interface | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli` | W3-S02, W2-S04, W2-S05 |
| W3-S04 | Harness capture and replay runtime | EPIC-4 | done | `packages/harness`, `packages/observability`, `packages/orchestrator-core` | W3-S02, W2-S05 |
| W3-S05 | Certification and promotion decision baseline | EPIC-4 | done | `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `apps/cli` | W3-S03, W3-S04 |
| W3-S06 | Quality rehearsal on selected public targets | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/**`, `packages/harness`, `apps/cli` | W3-S05, W0-S05 |

## W4 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W4-S01 | Isolated worktree and workspace execution foundation | EPIC-5 | done | `packages/orchestrator-core`, `packages/observability`, `docs/ops/**` | W2-S05, W1-S05 |
| W4-S02 | Delivery planning and write-back mode policy | EPIC-5 | done | `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**` | W4-S01, W1-S07, W3-S05 |
| W4-S03 | Patch and local branch delivery driver | EPIC-5 | done | `packages/orchestrator-core`, `apps/cli`, `packages/observability` | W4-S02 |
| W4-S04 | Fork-first GitHub PR delivery driver | EPIC-5 | done | `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `docs/ops/**` | W4-S02, W2-S04 |
| W4-S05 | Delivery manifest and release packet materialization | EPIC-5 | done | `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**`, `apps/cli` | W4-S03, W4-S04, W3-S05 |
| W4-S06 | Delivery rehearsal and recovery-safe operations | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/observability` | W4-S05, W0-S05 |

## W5 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W5-S01 | Control plane API read surface | EPIC-6 | done | `apps/api`, `packages/orchestrator-core`, `packages/contracts` | W4-S05, W2-S05 |
| W5-S02 | Live run event stream | EPIC-6 | done | `apps/api`, `packages/observability`, `docs/contracts/**` | W5-S01, W2-S05 |
| W5-S03 | CLI operator commands beyond bootstrap | EPIC-6 | done | `apps/cli`, `apps/api`, `docs/architecture/**` | W5-S01, W5-S02 |
| W5-S04 | Detachable web UI baseline | EPIC-6 | done | `apps/web`, `apps/api`, `docs/ops/**` | W5-S01, W5-S02 |
| W5-S05 | Standard live E2E orchestration runner | EPIC-7 | done | `apps/cli`, `apps/api`, `docs/ops/**`, `examples/live-e2e/**` | W5-S03, W4-S06, W3-S06 |
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
| W7-S05 | MVP+ governance and learning-loop integration closure | EPIC-7 | done | `docs/backlog/**`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability` | W7-S02, W7-S03, W7-S04 |

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
| W10-S05 | Externally verified live E2E target-catalog proof | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/observability`, `docs/backlog/**` | W10-S01, W10-S02, W11-S05 |

## W11 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W11-S01 | Source-of-truth reality repair | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**` | none |
| W11-S02 | Target workspace materialization for live E2E | EPIC-7 | done | `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**` | W11-S01 |
| W11-S03 | Profile-driven preflight and routed live execution | EPIC-3 | done | `apps/cli`, `packages/adapter-sdk`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**` | W11-S02 |
| W11-S04 | Target-anchored delivery and release evidence | EPIC-5 | done | `apps/cli`, `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**` | W11-S03 |
| W11-S05 | Fresh external proof bundle for catalog targets | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`, `docs/backlog/**` | W11-S04 |

## W12 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W12-S01 | Public surface realignment | EPIC-0 | done | `README.md`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**`, `docs/backlog/**` | none |
| W12-S02 | Internal black-box installed-user harness | EPIC-7 | done | `scripts/live-e2e/**`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability` | W12-S01 |
| W12-S03 | Breaking CLI and contract removal | EPIC-6 | done | `apps/cli`, `docs/contracts/**`, `packages/contracts`, `examples/**` | W12-S02 |
| W12-S04 | Proof refresh after surface cleanup | EPIC-7 | done | `docs/ops/**`, `examples/live-e2e/fixtures/**`, `packages/observability`, `scripts/live-e2e/**` | W12-S03 |

## W13 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W13-S01 | Backlog-first full-journey live E2E realignment | EPIC-0 | done | `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/architecture/**`, `docs/ops/**` | none |
| W13-S02 | Curated target and feature mission catalog | EPIC-7 | done | `scripts/live-e2e/catalog/**`, `scripts/live-e2e/profiles/**`, `docs/ops/**`, `docs/backlog/**` | W13-S01 |
| W13-S03 | Public bootstrap and feature-intent intake | EPIC-1 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/product/**` | W13-S02 |
| W13-S04 | Feature-driven discovery and execution lifecycle | EPIC-3 | done | `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W13-S03 |
| W13-S05 | Public review and learning-loop closure surfaces | EPIC-4 | done | `apps/cli`, `packages/contracts`, `packages/observability`, `docs/contracts/**`, `docs/architecture/**`, `docs/ops/**` | W13-S04 |
| W13-S06 | Full-journey harness and restored runner skill | EPIC-7 | done | `scripts/live-e2e/**`, `.agents/skills/**`, `docs/ops/**`, `examples/live-e2e/**`, `apps/cli/test/**` | W13-S05 |

## Planning note
Every wave document now includes a starter local-task outline for each slice. Agents should normally implement one slice at a time and refine only the local tasks inside that slice unless the shared backlog truly needs a new independently acceptable outcome.
