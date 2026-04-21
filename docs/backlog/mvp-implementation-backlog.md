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
| W2-S04 | Adapter SDK and mock adapter baseline | EPIC-3 | ready | `packages/adapter-sdk`, `packages/orchestrator-core`, `examples/adapters/**` | W2-S01 |
| W2-S05 | Routed step execution engine and durable step results | EPIC-3 | blocked | `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `packages/adapter-sdk` | W2-S02, W2-S03, W2-S04, W1-S06 |
| W2-S06 | First routed execution rehearsal | EPIC-7 | blocked | `apps/cli`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability` | W2-S05, W1-S07, W0-S05 |

## W3 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W3-S01 | Validation kernel generalization and asset graph checks | EPIC-4 | blocked | `packages/contracts`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/**` | W2-S05, W1-S04 |
| W3-S02 | Dataset and evaluation suite registry | EPIC-4 | blocked | `packages/contracts`, `packages/orchestrator-core`, `examples/eval/**` | W3-S01 |
| W3-S03 | Eval runner and scorer interface | EPIC-4 | blocked | `packages/harness`, `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli` | W3-S02, W2-S04, W2-S05 |
| W3-S04 | Harness capture and replay runtime | EPIC-4 | blocked | `packages/harness`, `packages/observability`, `packages/orchestrator-core` | W3-S02, W2-S05 |
| W3-S05 | Certification and promotion decision baseline | EPIC-4 | blocked | `packages/harness`, `packages/orchestrator-core`, `docs/contracts/**`, `apps/cli` | W3-S03, W3-S04 |
| W3-S06 | Quality rehearsal on selected public targets | EPIC-7 | blocked | `docs/ops/**`, `examples/live-e2e/**`, `packages/harness`, `apps/cli` | W3-S05, W0-S05 |

## W4 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W4-S01 | Isolated worktree and workspace execution foundation | EPIC-5 | blocked | `packages/orchestrator-core`, `packages/observability`, `docs/ops/**` | W2-S05, W1-S05 |
| W4-S02 | Delivery planning and write-back mode policy | EPIC-5 | blocked | `packages/orchestrator-core`, `docs/contracts/**`, `docs/architecture/**` | W4-S01, W1-S07, W3-S05 |
| W4-S03 | Patch and local branch delivery driver | EPIC-5 | blocked | `packages/orchestrator-core`, `apps/cli`, `packages/observability` | W4-S02 |
| W4-S04 | Fork-first GitHub PR delivery driver | EPIC-5 | blocked | `packages/orchestrator-core`, `packages/adapter-sdk`, `apps/cli`, `docs/ops/**` | W4-S02, W2-S04 |
| W4-S05 | Delivery manifest and release packet materialization | EPIC-5 | blocked | `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**`, `apps/cli` | W4-S03, W4-S04, W3-S05 |
| W4-S06 | Delivery rehearsal and recovery-safe operations | EPIC-7 | blocked | `docs/ops/**`, `examples/live-e2e/**`, `apps/cli`, `packages/observability` | W4-S05, W0-S05 |

## W5 slices
| Slice ID | Title | Epic | State | Primary modules | Hard dependencies |
|---|---|---|---|---|---|
| W5-S01 | Control plane API read surface | EPIC-6 | blocked | `apps/api`, `packages/orchestrator-core`, `packages/contracts` | W4-S05, W2-S05 |
| W5-S02 | Live run event stream | EPIC-6 | blocked | `apps/api`, `packages/observability`, `docs/contracts/**` | W5-S01, W2-S05 |
| W5-S03 | CLI operator commands beyond bootstrap | EPIC-6 | blocked | `apps/cli`, `apps/api`, `docs/architecture/**` | W5-S01, W5-S02 |
| W5-S04 | Detachable web UI baseline | EPIC-6 | blocked | `apps/web`, `apps/api`, `docs/ops/**` | W5-S01, W5-S02 |
| W5-S05 | Standard live E2E orchestration runner | EPIC-7 | blocked | `apps/cli`, `apps/api`, `docs/ops/**`, `examples/live-e2e/**` | W5-S03, W4-S06, W3-S06 |
| W5-S06 | Scorecards, incident capture, and learning-loop handoff | EPIC-7 | blocked | `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/backlog/**` | W5-S05, W3-S05 |

## Planning note
Every wave document now includes a starter local-task outline for each slice. Agents should normally implement one slice at a time and refine only the local tasks inside that slice unless the shared backlog truly needs a new independently acceptable outcome.
