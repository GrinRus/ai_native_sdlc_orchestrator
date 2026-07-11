# MVP roadmap

The authoritative planning model for implementation lives in:
- `docs/backlog/backlog-operating-model.md`
- `docs/backlog/mvp-implementation-backlog.md`
- `docs/backlog/orchestrator-epics.md`
- `docs/backlog/slice-dependency-graph.md`
- the wave documents `docs/backlog/wave-0-implementation-slices.md` through `docs/backlog/wave-63-implementation-slices.md`

## Wave summary
| Wave | Goal | Slice count | Primary epics | Detail doc |
|---|---|---:|---|---|
| W0 | Turn the design package into a contributor-safe and machine-validated repository foundation. | 6 | EPIC-0, EPIC-7 | `docs/backlog/wave-0-implementation-slices.md` |
| W1 | Make project bootstrap and early packet materialization work end to end in headless mode. | 8 | EPIC-6, EPIC-1, EPIC-4, EPIC-2, EPIC-7 | `docs/backlog/wave-1-implementation-slices.md` |
| W2 | Introduce the first real routed execution path across routes, wrappers, prompt bundles, policies, and adapters. | 6 | EPIC-3, EPIC-7 | `docs/backlog/wave-2-implementation-slices.md` |
| W3 | Build the validation, eval, harness, certification, and promotion stack that makes AOR quality-native by default. | 6 | EPIC-4, EPIC-7 | `docs/backlog/wave-3-implementation-slices.md` |
| W4 | Add safe write-back modes, manifests, and release artifacts so AOR can move from rehearsal to controlled delivery. | 6 | EPIC-5, EPIC-7 | `docs/backlog/wave-4-implementation-slices.md` |
| W5 | Expose operator-grade APIs, live views, and standardized internal installed-user rehearsal orchestration for the full control plane. | 6 | EPIC-6, EPIC-7 | `docs/backlog/wave-5-implementation-slices.md` |
| W6 | Deliver command-first post-MVP expansion for intake, run control, UI lifecycle, delivery/release prep, and incident/audit flows. | 6 | EPIC-0, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-6-implementation-slices.md` |
| W7 | Close MVP+ governance and quality stories for certification, finance evidence, and learning-loop integration. | 5 | EPIC-4, EPIC-7 | `docs/backlog/wave-7-implementation-slices.md` |
| W8 | Close later-maturity stories for strategic operator visibility, governance hardening, context lifecycle maturity, and multi-repo delivery maturity. | 9 | EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-8-implementation-slices.md` |
| W9 | Stabilize post-audit findings across routed evidence durability, source-of-truth docs, public quality surfaces, detached transport, and live execution foundations. | 8 | EPIC-0, EPIC-3, EPIC-4, EPIC-6 | `docs/backlog/wave-9-implementation-slices.md` |
| W10 | Reopen production-facing gaps left after the baseline audit across external runner execution, networked fork-first delivery, detached mutation transport, and live target-catalog proof. | 5 | EPIC-3, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-10-implementation-slices.md` |
| W11 | Close the remaining target-backed internal installed-user rehearsal proof gap through source-of-truth repair, target-checkout execution, target-anchored delivery evidence, and refreshed external proof. | 5 | EPIC-0, EPIC-3, EPIC-5, EPIC-7 | `docs/backlog/wave-11-implementation-slices.md` |
| W12 | Remove public installed-user rehearsal product surfaces, move rehearsal to an internal black-box proof harness, and refresh proof through installed-user style execution. | 4 | EPIC-0, EPIC-6, EPIC-7 | `docs/backlog/wave-12-implementation-slices.md` |
| W13 | Add a full user-journey internal installed-user rehearsal layer on curated public repositories, start each run from a concrete feature mission, and evaluate runtime plus quality verdicts through public surfaces. | 6 | EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-7 | `docs/backlog/wave-13-implementation-slices.md` |
| W14 | Expand internal installed-user rehearsal into a curated matrix across scenario families, pinned providers, and size-classed feature missions with matrix-aware review, audit, and closure evidence. | 7 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-14-implementation-slices.md` |
| W15 | Harden readiness signals after W14 by reopening the queue, aligning package/module evidence, and making coverage proof claims machine-checkable. | 3 | EPIC-0, EPIC-7 | `docs/backlog/wave-15-implementation-slices.md` |
| W16 | Reduce implementation complexity through behavior-preserving decomposition, shared helper extraction, and contract-first adapter permission cleanup. | 6 | EPIC-0, EPIC-3, EPIC-6, EPIC-7 | `docs/backlog/wave-16-implementation-slices.md` |
| W17 | Remove post-W16 legacy public aliases and stale compatibility documentation. | 1 | EPIC-0, EPIC-3, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-17-implementation-slices.md` |
| W18 | Close the connected web full-flow and topology proof gaps with control-plane-owned lifecycle mutations, interactive continuation semantics, and monorepo/bounded multirepo evidence. | 4 | EPIC-5, EPIC-6 | `docs/backlog/wave-18-implementation-slices.md` |
| W19 | Convert the user-story gap audit into traceable product, discovery, quality, learning, and planner backlog slices. | 6 | EPIC-0, EPIC-1, EPIC-2, EPIC-4, EPIC-6 | `docs/backlog/wave-19-implementation-slices.md` |
| W20 | Capture production and platform maturity gaps for multirepo locks, hardening, OpenCode candidate evidence, compiler revisions, and finance monitoring. | 5 | EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-20-implementation-slices.md` |
| W21 | Close installed-user onboarding and guided UX gaps from first launch through review, delivery, release, and learning closure. | 7 | EPIC-1, EPIC-2, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-21-implementation-slices.md` |
| W22 | Repair source-of-truth claims so the repository distinguishes baseline readiness from production readiness and treats OpenCode as extended candidate coverage until real certification exists. | 3 | EPIC-0, EPIC-3 | `docs/backlog/wave-22-implementation-slices.md` |
| W23 | Harden contract-first validation, production API auth scopes, and CLI/API lifecycle boundaries before deeper runtime ownership changes. | 3 | EPIC-4, EPIC-6 | `docs/backlog/wave-23-implementation-slices.md` |
| W24 | Move from step-level harness strength to run-level Runtime Harness ownership for production-grade orchestration decisions. | 3 | EPIC-4, EPIC-5, EPIC-6 | `docs/backlog/wave-24-implementation-slices.md` |
| W25 | Produce the first real non-mock full-journey production proof with code-changing evidence and no upstream writes. | 3 | EPIC-7 | `docs/backlog/wave-25-implementation-slices.md` |
| W26 | Make self-hosted production readiness repeatable, reviewable, and documented as a CLI/API production candidate with optional web. | 3 | EPIC-0, EPIC-7 | `docs/backlog/wave-26-implementation-slices.md` |
| W27 | Replace legacy internal installed-user rehearsal matrices with a black-box step journal and resumable interaction answers. | 5 | EPIC-6, EPIC-7 | `docs/backlog/wave-27-implementation-slices.md` |
| W28 | Close installed-user rehearsal gaps with install proof, evaluator naming cleanup, and expanded target coverage. | 3 | EPIC-7 | `docs/backlog/wave-28-implementation-slices.md` |
| W29 | Open the npm CLI alpha release channel with guarded release branch automation. | 1 | EPIC-5 | `docs/backlog/wave-29-implementation-slices.md` |
| W30 | Harden the self-hosted CLI/API alpha with ADRs, OpenAPI drift checks, operations runbooks, readiness evidence, and installed-user release smoke coverage. | 6 | EPIC-0, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-30-implementation-slices.md` |
| W31 | Launch the packaged local app for installed users and make first Mission intake understandable through the UI. | 1 | EPIC-6 | `docs/backlog/wave-31-implementation-slices.md` |
| W32 | Add runtime-owned interactive operator requests across CLI, API, and the local app for bounded artifact analysis and change proposals. | 1 | EPIC-6 | `docs/backlog/wave-32-implementation-slices.md` |
| W33 | Align the post-rebase console source of truth around `aor app`, remove the static snapshot surface, and preserve local-alpha stabilization fixes without adding security/hosted scope. | 10 | EPIC-0, EPIC-6 | `docs/backlog/wave-33-implementation-slices.md` |
| W34 | Refactor the local console around runtime-owned flows and prove the flow loop through browser-task internal installed-user rehearsal evidence. | 7 | EPIC-0, EPIC-6, EPIC-7 | `docs/backlog/wave-34-implementation-slices.md` |
| W35 | Harden internal installed-user rehearsal operator UX for long-running providers, decision helper automation, readable artifacts, execution evidence, and Codex/Qwen proof. | 5 | EPIC-6, EPIC-7 | `docs/backlog/wave-35-implementation-slices.md` |
| W36 | Make the local app self-guided from a no-settings launch and support explicitly added local projects without mixing runtime state. | 5 | EPIC-1, EPIC-6, EPIC-7 | `docs/backlog/wave-36-implementation-slices.md` |
| W37 | Replan W35-S05 around bounded target setup and verification closure so Codex/Qwen proof attempts do not block before operator-visible decisions. | 1 | EPIC-7 | `docs/backlog/wave-37-implementation-slices.md` |
| W38 | Make Qwen candidate internal installed-user rehearsal progress observable through official stream-json output instead of treating buffered JSON stdout as provider silence. | 1 | EPIC-6, EPIC-7 | `docs/backlog/wave-38-implementation-slices.md` |
| W39 | Standardize internal installed-user rehearsal provider lifecycle semantics across Codex, Claude, OpenCode, and Qwen while keeping adapter-specific launch/progress behavior at the adapter boundary. | 1 | EPIC-7 | `docs/backlog/wave-39-implementation-slices.md` |
| W40 | Turn alpha.7 installed-user findings into the next hardening wave for onboarding UX, active internal installed-user rehearsal heartbeat visibility, release docs, and optional provider qualification. | 4 | EPIC-0, EPIC-1, EPIC-6, EPIC-7 | `docs/backlog/wave-40-implementation-slices.md` |
| W41 | Validate the published alpha.8 installed-user path, refresh provider qualification evidence, and turn findings into scoped fixes or follow-up backlog. | 4 | EPIC-0, EPIC-1, EPIC-6, EPIC-7 | `docs/backlog/wave-41-implementation-slices.md` |
| W42 | Publish the post-alpha.8 user-facing fix as alpha.9 and then clean up operator-initiated internal installed-user rehearsal interruption ownership semantics. | 2 | EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-42-implementation-slices.md` |
| W43 | Validate the published alpha.10 package and refresh installed-user/internal installed-user rehearsal confidence evidence after the operator interruption classification release. | 4 | EPIC-0, EPIC-1, EPIC-6, EPIC-7 | `docs/backlog/wave-43-implementation-slices.md` |
| W44 | Split discovery/research/spec prompt assets and define readiness transitions while preserving artifact execution compatibility. | 5 | EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-44-implementation-slices.md` |
| W45 | Make review/QA repair cycles bounded, contract-first, operator-visible, and replayable from prompt/context lineage through proof evidence. | 6 | EPIC-0, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-45-implementation-slices.md` |
| W46 | Rebuild internal installed-user rehearsal as black-box product-change assessment with step-quality gates, larger mission budgets, catalog migration, and hard target expansion. | 6 | EPIC-0, EPIC-7 | `docs/backlog/wave-46-implementation-slices.md` |
| W47 | Convert W46 classified blockers into strict product acceptance by closing AOR UI accessibility, hard-target verification isolation, repair convergence evidence, and proof reruns. | 4 | EPIC-0, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-47-implementation-slices.md` |
| W48 | Extend medium+ product-change rehearsal into a realistic implementation quality cycle with QA-origin repair, structured repair context, hard-target toolchain policy, and successor-proof reconciliation. | 5 | EPIC-0, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-48-implementation-slices.md` |
| W49 | Close quality-cycle proof gaps with repair anti-loop enforcement, QA-specific step quality, findings hygiene, and mandatory Full Control live proof rerun. | 4 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-49-implementation-slices.md` |
| W50 | Close W49 Fastify/Vitest blockers with review verification mapping, target toolchain fail-fast, control proof rerun, and findings sync. | 4 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-50-implementation-slices.md` |
| W51 | Turn W50 proof into clean-commit closure, pursue Vitest large acceptance, automate final quality hydration, split target-readiness semantics, and add the next hard target only after large proof is stable. | 5 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-51-implementation-slices.md` |
| W52 | Convert the remaining Vitest and SQLAlchemy hard-target installed-user rehearsal evidence into product acceptance or precise non-acceptance blockers, then harden manual evidence depth and final acceptance reporting. | 10 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-52-implementation-slices.md` |
| W53 | Generalize target verification into AOR command groups and enforce the boundary between AOR runtime artifacts and live E2E proof harness evidence. | 5 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-53-implementation-slices.md` |
| W54 | Turn generic verification command groups into an authoring, discovery, profile-generation, operator-inspection, and public-boundary hardening workflow for arbitrary project stacks. | 8 | EPIC-0, EPIC-1, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-54-implementation-slices.md` |
| W55 | Turn `ky` large/xlarge control findings into actionable repair evidence, target-catalog alignment, Claude guardrails, and rerun reporting. | 5 | EPIC-0, EPIC-4, EPIC-7 | `docs/backlog/wave-55-implementation-slices.md` |
| W56 | Harden the installed-user console so first-run setup and active-flow cockpit work stay primary while advanced evidence remains progressively disclosed. | 3 | EPIC-1, EPIC-6 | `docs/backlog/wave-56-implementation-slices.md` |
| W57 | Restore execution, filesystem, permission, delivery, and evidence trust boundaries from the July 2026 codebase audit before credentialed or write-capable use. | 8 | EPIC-0, EPIC-1, EPIC-2, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-57-implementation-slices.md` |
| W58 | Make read models, context, routing, evaluation, jobs, live events, APIs, and the loopback local-app transport truthful and executable. | 8 | EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-58-implementation-slices.md` |
| W59 | Replace source-marker confidence with browser behavior, harden the local console, ratchet code quality, decompose hotspots, and independently close the audit. | 7 | EPIC-0, EPIC-1, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-59-implementation-slices.md` |
| W60 | Replace generic task lists with structured, versioned, execution-ready plans and an operator Plan workbench. | 5 | EPIC-0, EPIC-2, EPIC-3, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-60-implementation-slices.md` |
| W61 | Add portable project/repository/component topology, persistent local bindings, and installed-user Project Structure management. | 5 | EPIC-0, EPIC-1, EPIC-2, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-61-implementation-slices.md` |
| W62 | Execute approved task DAGs through isolated workspace sets, bounded concurrency, integration, repair, and coordinated delivery. | 6 | EPIC-0, EPIC-2, EPIC-3, EPIC-4, EPIC-5, EPIC-6, EPIC-7 | `docs/backlog/wave-62-implementation-slices.md` |
| W63 | Consolidate the installed operator console around safe Mission intake, truthful next actions, adaptive navigation, evidence work, and a reusable visual system. | 7 | EPIC-0, EPIC-1, EPIC-2, EPIC-3, EPIC-4, EPIC-6, EPIC-7 | `docs/backlog/wave-63-implementation-slices.md` |

## Post-MVP story allocation
| Slice ID | Story IDs closed |
|---|---|
| W6-S01 | enablement slice (no direct story closure) |
| W6-S02 | PSO-07, DIS-07, PBO-06, PBO-07 |
| W6-S03 | EMP-07, DEV-09, OPS-09, SEC-05 |
| W6-S04 | DEV-08, ARC-06 |
| W6-S05 | DTX-06, DTX-07, RMO-05 |
| W6-S06 | INC-05 |
| W7-S01 | ARC-07, RQA-05, FIN-07 |
| W7-S02 | AIP-07, AIP-08, AIP-09, AIP-10, FIN-05 |
| W7-S03 | INC-04 |
| W7-S04 | FIN-06 |
| W7-S05 | integration closure (wave-level evidence) |
| W8-S01 | PSO-08, EMP-08 |
| W8-S02 | DIS-08, ARC-08 |
| W8-S03 | DEV-10, SEC-06 |
| W8-S04 | OPS-10 |
| W8-S05 | RQA-06, AIP-11 |
| W8-S06 | INC-06, AIP-12 |
| W8-S07 | RMO-06, PBO-08, DTX-08, FIN-08 |
| W8-S08 | integration closure (compiled-context runtime foundation) |
| W8-S09 | integration closure (context lifecycle governance evidence) |
| W9-S01 | post-audit stabilization bugfix (no direct story closure) |
| W9-S02 | post-audit documentation drift repair (no direct story closure) |
| W9-S03 | post-audit API/runtime alignment fix (no direct story closure) |
| W9-S04 | post-audit contract coverage enablement (no direct story closure) |
| W9-S05 | post-audit quality surface completion (no direct story closure) |
| W9-S06 | post-audit promotion surface completion (no direct story closure) |
| W9-S07 | post-audit transport baseline feature (no direct story closure) |
| W9-S08 | post-audit live execution baseline feature (no direct story closure) |
| W10-S01 | productionization gap closure: external live adapter execution (no direct story closure) |
| W10-S02 | productionization gap closure: networked fork-first delivery (no direct story closure) |
| W10-S03 | productionization gap closure: detached mutation transport (no direct story closure) |
| W10-S04 | productionization gap closure: detached transport auth hardening (no direct story closure) |
| W10-S05 | productionization gap closure: external live target-catalog proof (no direct story closure) |
| W11-S01 | productionization gap closure: source-of-truth reality repair (no direct story closure) |
| W11-S02 | productionization gap closure: target-backed workspace materialization (no direct story closure) |
| W11-S03 | productionization gap closure: profile-driven live preflight and routed execution (no direct story closure) |
| W11-S04 | productionization gap closure: target-anchored delivery evidence (no direct story closure) |
| W11-S05 | productionization gap closure: refreshed target-catalog proof bundle (no direct story closure) |
| W12-S01 | public surface realignment and breaking removal planning (no direct story closure) |
| W12-S02 | Internal Installed-User Proof Harness (no direct story closure) |
| W12-S03 | breaking CLI and contract removal (no direct story closure) |
| W12-S04 | proof refresh after surface cleanup (no direct story closure) |
| W15-S01 | readiness hardening: source-of-truth queue repair (no direct story closure) |
| W15-S02 | readiness hardening: package/module workspace alignment (no direct story closure) |
| W15-S03 | readiness hardening: proof verdict integrity gates (no direct story closure) |
| W16-S01 | implementation complexity reduction: shared helper extraction (no direct story closure) |
| W16-S02 | implementation complexity reduction: CLI dispatcher decomposition (no direct story closure) |
| W16-S03 | implementation complexity reduction: API/read-surface decomposition (no direct story closure) |
| W16-S04 | implementation complexity reduction: orchestrator-core execution decomposition (no direct story closure) |
| W16-S05 | implementation complexity reduction: installed-user runner decomposition (no direct story closure) |
| W16-S06 | implementation complexity reduction: adapter permission legacy cleanup (no direct story closure) |
| W17-S01 | post-W16 legacy surface cleanup (no direct story closure) |
| W18-S01 | gap closure: interactive run continuation contract for connected operator surfaces |
| W18-S02 | gap closure: full lifecycle command mutations for connected web |
| W18-S03 | gap closure: detachable web full-flow operator console |
| W18-S04 | gap closure: monorepo and bounded multirepo flow proof |
| W19-S01 | gap traceability target: original 112 story IDs |
| W19-S02 | gap closure target: PSO-01, PSO-02, PSO-07, PBO-07 |
| W19-S03 | gap closure target: DIS-03, DIS-07, DIS-08, ARC-08, PBO-08 |
| W19-S04 | gap closure target: RQA-05, INC-03, INC-05 |
| W19-S05 | gap closure target: PSO-03, PSO-05, DEV-05, RQA-02, RQA-06, OPS-04 |
| W19-S06 | gap closure target: PSO-08, EMP-02, EMP-03, EMP-07, EMP-08, OPS-10 |
| W20-S01 | gap closure target: RMO-02, RMO-03, RMO-04, RMO-05, RMO-06, DTX-08, PBO-08 |
| W20-S02 | gap closure target: DEV-10, OPS-10, SEC-02, SEC-06 |
| W20-S03 | gap closure target: DEV-04, AIP-12 |
| W20-S04 | gap closure target: AIP-05, INC-03 |
| W20-S05 | gap closure target: INC-06, FIN-01, FIN-02, FIN-07, FIN-08 |
| W21-S01 | installed-user guided UX target: PSO-01, PSO-02, PSO-03, PBO-07, OPS-04 |
| W21-S02 | installed-user guided UX target: PBO-01, PBO-02, PBO-03, OPS-01 |
| W21-S03 | installed-user guided UX target: PBO-06, PBO-07, PBO-08, PSO-01 |
| W21-S04 | installed-user guided UX target: PSO-01, PSO-02, PSO-07, PBO-07, EMP-02 |
| W21-S05 | installed-user guided UX target: PSO-03, PSO-08, OPS-01, OPS-02, OPS-04, OPS-10 |
| W21-S06 | installed-user guided UX target: PSO-05, DEV-05, RQA-02, RQA-06, OPS-04, DTX-07 |
| W21-S07 | installed-user guided UX target: OPS-06, OPS-07, PBO-01, PBO-02, PBO-03, DTX-07 |
| W22-S01 | evidence-strength status repair target: original 112 story IDs |
| W22-S02 | production-readiness source-of-truth repair (no direct story closure) |
| W22-S03 | OpenCode downgrade target: DEV-04, AIP-12, OPS-07 |
| W23-S01 | production contract validation target: review, incident, learning, packet, and runtime evidence stories |
| W23-S02 | production auth target: SEC-02, SEC-06, DEV-10, OPS-04 |
| W23-S03 | lifecycle boundary target: CLI/API headless-first operator stories |
| W24-S01 | run-level harness target: DEV-05, RQA-02, RQA-06, OPS-05 |
| W24-S02 | interactive continuation target: EMP-03, OPS-04, DEV-05, SEC-02 |
| W24-S03 | strict delivery target: PSO-05, DEV-05, DTX-01, DTX-02, DTX-03, DTX-04 |
| W25-S01 | real external-runner proof target: OPS-06, OPS-07, DEV-03, DEV-04, AIP-12 |
| W25-S02 | real code-changing proof target: OPS-07, DEV-05, DTX-01, DTX-04, FIN-03 |
| W25-S03 | proof fixture and story upgrade target: OPS-07 and directly proven related stories |
| W26-S01 | production-readiness gate target: production security, proof, and traceability stories |
| W26-S02 | maintainability stabilization target: production-touched runtime and control-plane surfaces |
| W26-S03 | self-hosted release documentation target: operator, security, delivery, release, and readiness surfaces |
| W30-S01 | enablement slice (post-W29 source-of-truth planning) |
| W30-S02 | ARC-01, ARC-08, OPS-10, SEC-06 |
| W30-S03 | OPS-01, OPS-02, OPS-10, SEC-02, SEC-06 |
| W30-S04 | OPS-04, OPS-06, OPS-10, SEC-02, SEC-06 |
| W30-S05 | OPS-06, OPS-10, SEC-06, DEV-04, AIP-12 |
| W30-S06 | OPS-06, OPS-10, PBO-01, PBO-02, PBO-03, SEC-02, SEC-06 |
| W31-S01 | PBO-09, OPS-01, OPS-06 |
| W32-S01 | OPS-11, OPS-04, DEV-05, RQA-02 |
| W33-S01 | source-of-truth alignment and obsolete console surface removal (no direct story closure) |
| W33-S02 | local-alpha gate reliability repair (no direct story closure) |
| W33-S03 | local-alpha run-state repair (no direct story closure) |
| W33-S04 | local-alpha guided runtime-root repair (no direct story closure) |
| W33-S05 | local-alpha control-plane/app launch guidance repair (no direct story closure) |
| W33-S06 | local-alpha app-smoke console boundary repair (no direct story closure) |
| W33-S07 | local-alpha CLI ergonomics repair (no direct story closure) |
| W33-S08 | local-alpha OpenAPI payload clarity repair (no direct story closure) |
| W33-S09 | local-alpha runtime read-model scale repair (no direct story closure) |
| W33-S10 | local-alpha web maintainability repair (no direct story closure) |
| W34-S01 | flow-centric UI refactor target: PBO-09, OPS-01, OPS-11 |
| W34-S02 | flow-centric control-plane target: PBO-09, OPS-01, OPS-11 |
| W34-S03 | flow-first local console target: PBO-09, OPS-01, OPS-10 |
| W34-S04 | flow-scoped evidence and interaction target: OPS-02, OPS-03, OPS-11, DEV-06, DEV-07 |
| W34-S05 | closure-to-new-flow target: PSO-05, OPS-04, DTX-07, INC-06 |
| W34-S06 | browser-task guided proof target: OPS-06, OPS-07, PBO-09, OPS-11 |
| W34-S07 | source-of-truth alignment and release-gate evidence (no direct story closure) |
| W35-S01 | long-running provider heartbeat target: OPS-01, OPS-06, OPS-07, OPS-11 |
| W35-S02 | readable evidence artifact target: OPS-02, OPS-03, OPS-11, DEV-06, DEV-07 |
| W35-S03 | skill-agent decision helper target: OPS-04, OPS-06, OPS-07, OPS-11 |
| W35-S04 | execution evidence and interruption target: OPS-01, OPS-04, OPS-06, OPS-07, OPS-11, DEV-05, RQA-02 |
| W35-S05 | Codex/Qwen UX proof target: OPS-06, OPS-07, OPS-11, PBO-09 |
| W36-S01 | no-settings onboarding and local workspace contract target: PBO-09, OPS-01, OPS-10 |
| W36-S02 | local app project registry target: PBO-09, OPS-01, RMO-01 |
| W36-S03 | first-run wizard target: PBO-01, PBO-02, PBO-03, PBO-09 |
| W36-S04 | local multi-project switcher target: PBO-09, OPS-01, OPS-10 |
| W36-S05 | no-settings UI proof target: OPS-06, OPS-10, PBO-09 |
| W37-S01 | internal installed-user rehearsal target setup closure target: OPS-06, OPS-07, OPS-11 |
| W38-S01 | Qwen stream progress adapter target: OPS-01, OPS-06, OPS-07, OPS-11 |
| W39-S01 | provider-neutral internal installed-user rehearsal lifecycle target: OPS-01, OPS-06, OPS-07, OPS-11 |
| W40-S01 | post-alpha.7 backlog baseline and release smoke traceability (no direct story closure) |
| W40-S02 | installed-user onboarding hardening target: PBO-09, OPS-01, OPS-06, OPS-10 |
| W40-S03 | active internal installed-user rehearsal heartbeat surfacing target: OPS-01, OPS-06, OPS-07, OPS-11 |
| W40-S04 | optional provider qualification matrix target: DEV-04, AIP-12, OPS-06, OPS-07 |
| W41-S01 | post-alpha.8 backlog baseline and validation traceability (no direct story closure) |
| W41-S02 | alpha.8 installed-user onboarding smoke target: PBO-01, PBO-02, PBO-09, OPS-01, OPS-06, OPS-10 |
| W41-S03 | alpha.8 provider qualification smoke target: DEV-04, AIP-12, OPS-06, OPS-07, OPS-11 |
| W41-S04 | alpha.8 findings closure target: OPS-01, OPS-06, OPS-10, OPS-11 |
| W42-S01 | alpha.9 release prep for W41 user-facing fix (no direct story closure) |
| W42-S02 | operator-initiated interruption owner classification target: OPS-01, OPS-06, OPS-11 |
| W43-S01 | post-alpha.10 backlog baseline and traceability (no direct story closure) |
| W43-S02 | alpha.10 installed-user smoke target: PBO-09, OPS-01, OPS-06, OPS-10 |
| W43-S03 | alpha.10 internal installed-user rehearsal interruption/provider smoke target: DEV-04, AIP-12, OPS-06, OPS-07, OPS-11 |
| W43-S04 | alpha.10 findings closure target: OPS-01, OPS-06, OPS-10, OPS-11 |
| W44-S01 | artifact workflow taxonomy and transition invariant target: DIS-03, DIS-07, DIS-08, ARC-08, OPS-10 |
| W44-S02 | discovery/research/spec prompt asset granularity target: DIS-03, DIS-07, DIS-08, ARC-08 |
| W44-S03 | artifact readiness and stale transition target: DIS-07, DIS-08, ARC-08, PBO-07, OPS-10 |
| W44-S04 | context/skill/policy overlay governance target: DIS-08, ARC-08, RQA-06, AIP-11, OPS-10 |
| W44-S05 | post-implementation docs and internal installed-user rehearsal proof target: DIS-08, ARC-08, DEV-04, OPS-06, OPS-10, OPS-11 |
| W45-S01 | quality repair contract target: DEV-05, DEV-07, RQA-02, RQA-06, OPS-04 |
| W45-S02 | bounded repair state-machine target: DEV-05, EMP-07, RQA-05, RQA-06, OPS-01 |
| W45-S03 | quality repair CLI/API target: DEV-05, RQA-02, OPS-04, OPS-10 |
| W45-S04 | repair-cycle console visibility target: OPS-01, OPS-02, OPS-04, OPS-11, RQA-02 |
| W45-S05 | repair-loop proof/profile target: DEV-05, RQA-05, OPS-06, OPS-07, FIN-03 |
| W45-S06 | post-implementation docs/internal installed-user rehearsal acceptance target: DEV-05, DEV-07, RQA-02, RQA-05, RQA-06, OPS-04, OPS-06, OPS-07, FIN-03 |
| W56-S01 | first-run console UX hardening target: PBO-09, OPS-01, OPS-10, OPS-11 |
| W56-S02 | rendered cockpit UX hardening target: PBO-09, OPS-01, OPS-10, OPS-11 |
| W56-S03 | rendered UX audit closure target: PBO-09, OPS-01, OPS-10, OPS-11 |
| W57-S01 | audit disposition and local-app threat-model target: EMP-05, DEV-07, AIP-06, OPS-02, OPS-06, OPS-10, SEC-04, SEC-06, PBO-09, DTX-05, FIN-03 |
| W57-S02 | identifier/path/scope contract repair target: ARC-01, PBO-01, PBO-05, OPS-02, SEC-04, DTX-01, DTX-02, DTX-03, DTX-05, FIN-03 |
| W57-S03 | no-write and workspace-isolation repair target: DEV-01, DEV-09, PBO-01, SEC-04, DTX-05 |
| W57-S04 | structural permission enforcement target: ARC-01, DEV-09, OPS-03, SEC-01, SEC-04, SEC-05 |
| W57-S05 | exact delivery and resolvable evidence target: PSO-05, RQA-02, RQA-06, OPS-04, SEC-04, DTX-01, DTX-02, DTX-03, DTX-04, DTX-07, FIN-03 |
| W57-S06 | transactional initialization target: PBO-01, PBO-05, PBO-09, FIN-03 |
| W57-S07 | atomic execution/run/event identity target: EMP-03, EMP-05, EMP-06, DEV-01, OPS-01, OPS-02, OPS-04, OPS-09, SEC-03, FIN-03, FIN-04 |
| W57-S08 | W57 safety and release-disposition proof target: OPS-06, OPS-07, SEC-04, FIN-03 |
| W58-S01 | non-materializing read-model target: PBO-05, PBO-09, OPS-01 |
| W58-S02 | effective context and unique asset target: DIS-02, ARC-02, ARC-04, DEV-07, AIP-01, AIP-02, PBO-06, SEC-04 |
| W58-S03 | executable routing/policy/adapter target: ARC-02, DEV-01, DEV-05, EMP-07, AIP-03, AIP-04, OPS-03, SEC-04 |
| W58-S04 | real eval/Harness/replay target: PSO-05, ARC-03, ARC-04, RQA-03, RQA-04, AIP-05, AIP-06, AIP-07, OPS-05 |
| W58-S05 | asynchronous run and durable live-event target: EMP-05, DEV-01, OPS-01, OPS-02, OPS-04, OPS-10 |
| W58-S06 | canonical API/OpenAPI/CLI target: ARC-06, OPS-01, OPS-02, OPS-04, OPS-09, OPS-11, SEC-02, SEC-06, FIN-04 |
| W58-S07 | loopback-only local transport target: ARC-06, PBO-09, OPS-04, OPS-10, OPS-11, SEC-06 |
| W58-S08 | W58 runtime-quality acceptance target: OPS-06, OPS-07, FIN-03 |
| W59-S01 | executable browser behavior-gate target: PBO-09, OPS-01, OPS-04, OPS-06, OPS-07, OPS-11 |
| W59-S02 | local console live-state and interaction target: ARC-06, PBO-09, EMP-05, OPS-01, OPS-02, OPS-04, OPS-10, OPS-11 |
| W59-S03 | accessible dialog and web decomposition target: PBO-09, OPS-01, OPS-10, OPS-11 |
| W59-S04 | repository code-quality/dependency ratchet (no direct story closure) |
| W59-S05 | core/CLI/control-plane decomposition target: ARC-06, DEV-01, DEV-05, OPS-01, OPS-06, OPS-10 |
| W59-S06 | adapter/live-E2E decomposition and contract parity target: DEV-01, DEV-07, AIP-02, AIP-03, AIP-04, OPS-06, OPS-07 |
| W59-S07 | independent audit closure and readiness-decision target: OPS-06, OPS-07, PSO-06, FIN-03 |
| W60-S01 | structured task contract and backlog detail target: EMP-01, EMP-02, ARC-05, PSO-07, OPS-10 |
| W60-S02 | planner decomposition and task quality target: EMP-01, EMP-02, DIS-05, ARC-05, PSO-07 |
| W60-S03 | execution plan and task-progress target: EMP-02, EMP-03, EMP-07, DEV-05, OPS-01, OPS-10 |
| W60-S04 | Plan workbench and approval UX target: EMP-01, EMP-02, EMP-03, PSO-04, PSO-07, OPS-01, OPS-02, OPS-10 |
| W60-S05 | structured planning proof target: EMP-02, EMP-03, OPS-06, OPS-10, FIN-03 |
| W61-S01 | project topology and binding contract target: RMO-01, RMO-02, PBO-01, PBO-07, PBO-08, ARC-01 |
| W61-S02 | persistent local registry and discovery target: PBO-01, PBO-03, PBO-07, PBO-08, RMO-01, RMO-02 |
| W61-S03 | topology CLI/API management target: RMO-01, RMO-02, PBO-03, PBO-04, PBO-05, OPS-01, OPS-10 |
| W61-S04 | Add Project and Project Structure UX target: PBO-01, PBO-03, PBO-08, PBO-09, RMO-01, RMO-02, OPS-01, OPS-10 |
| W61-S05 | topology onboarding proof target: PBO-08, PBO-09, RMO-01, RMO-02, OPS-06, OPS-10 |
| W62-S01 | workspace-set and repo-change evidence target: RMO-01, RMO-04, DEV-01, DTX-05, SEC-04 |
| W62-S02 | impact scope and execution DAG target: EMP-02, EMP-03, ARC-01, RMO-02, RMO-04, PSO-07 |
| W62-S03 | parent/child scheduler target: EMP-03, EMP-04, EMP-05, DEV-01, DEV-05, OPS-01, OPS-07 |
| W62-S04 | integration, stale invalidation, and repair target: DEV-05, RQA-02, RQA-05, RMO-04, DTX-06, OPS-04 |
| W62-S05 | coordinated delivery and execution UX target: EMP-03, RMO-03, RMO-04, RMO-05, RMO-06, DTX-04, DTX-08, OPS-01, OPS-10 |
| W62-S06 | monorepo/multirepo full-flow proof target: EMP-03, DEV-05, RMO-04, RMO-05, RMO-06, DTX-06, DTX-08, OPS-06, OPS-10, FIN-03 |
| W63-S01 | operator journey, action semantics, and scenario enablement (no direct story closure) |
| W63-S02 | semantic design-system enablement (no direct story closure) |
| W63-S03 | guided Mission intake target: PBO-01, PBO-05, PBO-09, OPS-01, OPS-10 |
| W63-S04 | truthful cockpit action and recovery target: OPS-01, OPS-02, OPS-04, OPS-10, OPS-11 |
| W63-S05 | adaptive shell and lifecycle navigation target: PBO-09, OPS-01, OPS-10, OPS-11 |
| W63-S06 | attention queue and evidence workbench target: PBO-09, OPS-01, OPS-04, OPS-10, OPS-11 |
| W63-S07 | installed-console UX/UI acceptance target: PBO-09, OPS-01, OPS-02, OPS-04, OPS-10, OPS-11, RQA-01, RQA-02, RQA-06 |

## W0 — repository and contract foundation
**Goal:** Turn the design package into a contributor-safe and machine-validated repository foundation.

**Exit criteria:**
- the workspace has honest root commands and a stable scaffold for future packages and apps
- contracts and examples are loaded and checked through shared validation paths
- the backlog model is wave → epic → slice → local task and is usable by agents without guesswork
- internal installed-user rehearsal profiles support a no-write preflight path before any delivery automation exists
- CI gates prevent contract, example, and roadmap drift

**Detailed slices:** `docs/backlog/wave-0-implementation-slices.md`

## W1 — bootstrap and packet foundation
**Goal:** Make project bootstrap and early packet materialization work end to end in headless mode.

**Exit criteria:**
- `aor project init`, `analyze`, `validate`, and `verify` have working smoke paths
- runtime state materializes under `.aor/` with durable project-scoped artifact directories
- project-analysis, validation, and step-result artifacts are contract-compliant and reloadable
- artifact, wave, and handoff packet skeletons can be created and validated
- a no-write bootstrap rehearsal works on the AOR repo and one selected public target

**Detailed slices:** `docs/backlog/wave-1-implementation-slices.md`

## W2 — routed execution foundation
**Goal:** Introduce the first real routed execution path across routes, wrappers, prompt bundles, policies, and adapters.

**Exit criteria:**
- route resolution works for at least discovery, research, plan, implement, review, and QA step shapes
- wrappers, prompt bundles, and step policies resolve through one runtime stack
- the adapter SDK supports capability negotiation and a mock adapter for deterministic rehearsal
- routed execution writes durable step results with asset, budget, and adapter metadata
- a no-write routed rehearsal runs against approved packets without delivery-side write-back

**Detailed slices:** `docs/backlog/wave-2-implementation-slices.md`

## W3 — quality foundation
**Goal:** Build the validation, eval, harness, certification, and promotion stack that makes AOR quality-native by default.

**Exit criteria:**
- asset-graph validation covers routes, wrappers, prompt bundles, step policies, datasets, suites, and internal installed-user rehearsal profiles
- datasets and evaluation suites are registry-backed and executable through one eval runtime
- harness capture and replay produce normalized evidence that can be compared across changes
- wrapper and route changes can be certified through reusable eval and harness workflows
- promotion decisions are durable artifacts rather than ad hoc release notes

**Detailed slices:** `docs/backlog/wave-3-implementation-slices.md`

## W4 — delivery foundation
**Goal:** Add safe write-back modes, manifests, and release artifacts so AOR can move from rehearsal to controlled delivery.

**Exit criteria:**
- isolated execution supports patch, local branch, and fork-first delivery modes
- write-back policy is explicit and machine-checkable before a delivery run starts
- delivery outputs can be materialized as patches, branches, and PR-ready changesets
- delivery manifests and release packets capture the exact evidence chain for every run
- delivery rehearsal on public targets remains recovery-safe and upstream-safe by default

**Detailed slices:** `docs/backlog/wave-4-implementation-slices.md`

## W5 — operator and internal installed-user rehearsal foundation
**Goal:** Expose operator-grade APIs, live views, and standardized internal installed-user rehearsal orchestration for the full control plane.

**Exit criteria:**
- the control plane exposes read APIs for project state, packets, runs, and quality evidence
- live run events stream through a stable event model usable by CLI and web surfaces
- CLI and detachable web UI can inspect runs and perform bounded interventions
- standard internal installed-user rehearsal profiles execute through the same control plane used by product features
- scorecards, incident capture, and learning-loop outputs are durable artifacts

**Detailed slices:** `docs/backlog/wave-5-implementation-slices.md`

## W6 — command-surface expansion
**Goal:** Expand the control plane from read-only operations into bounded command execution and operational controls.

**Exit criteria:**
- backlog tooling can discover and schedule `W6+` slices without manual script edits
- planned command contracts for intake/discovery/spec/wave are implemented and tested
- run lifecycle controls are implemented with explicit policy and audit traceability
- UI attach/detach lifecycle commands are implemented without breaking headless-first operation
- delivery/release prepare and incident/audit command packs materialize durable artifacts

**Detailed slices:** `docs/backlog/wave-6-implementation-slices.md`

## W7 — MVP+ governance and quality closure
**Goal:** Close remaining MVP+ governance and quality outcomes across certification, finance evidence, and learning-loop control.

**Exit criteria:**
- governance-focused quality checks are executable through one certification/eval path
- AI platform promotion/freeze readiness includes stronger regression evidence and finance linkage
- incident recertification and follow-up handoff flows are contract-backed and runnable
- finance/audit visibility is durable and queryable from the same command and API surfaces

**Detailed slices:** `docs/backlog/wave-7-implementation-slices.md`

## W8 — later maturity closure
**Goal:** Close later-maturity stories with durable operational, governance, and delivery orchestration behavior.

**Exit criteria:**
- strategic sponsor/manager visibility stories are addressed through stable operator surfaces
- later discovery, architecture, and security governance stories are represented in executable flows
- routed execution compiles prompt/context assets into durable compiled-context artifacts and injects adapter-ready context payloads
- context updates are versioned, policy-gated, and promotion-auditable with explicit provenance
- multi-repo and delivery rerun maturity stories are closed with bounded artifacts and policies
- incident and AI platform later-stage recertification loops are replayable and auditable

**Detailed slices:** `docs/backlog/wave-8-implementation-slices.md`

## W9 — post-audit stabilization and execution expansion
**Goal:** Fix audit-discovered bugs and source-of-truth drift first, then reopen bounded platform expansion for detached transport and live routed execution.

**Exit criteria:**
- routed execution evidence is durable per run and no longer overwrites prior same-step artifacts
- repo-entry docs and control-plane docs distinguish current implementation from target architecture accurately
- control-plane API contract coverage is machine-checkable through the shared loader path
- public CLI quality surfaces include harness replay plus asset promote/freeze workflows
- connected web mode can consume a detached HTTP/SSE control-plane transport while headless operation remains supported
- a first supported non-mock adapter can execute live routed work under explicit guardrails

**Detailed slices:** `docs/backlog/wave-9-implementation-slices.md`

## W10 — production-facing execution and delivery proof
**Goal:** Convert the current baselines into externally exercised runtime paths so the backlog once again reflects the remaining work between implementation baseline and production-facing proof.

**Exit criteria:**
- the supported live adapter path invokes an external runner rather than returning an in-process deterministic success envelope
- fork-first delivery can perform bounded GitHub fork/branch/PR draft writes when approvals and credentials are present, while preserving safe planning-only fallbacks
- detached transport supports bounded authenticated mutation commands for connected operator clients
- at least one regression target and one release-shaped target from the catalog have fresh live evidence produced through the external runner and real bounded delivery paths

**Current status note:** `W10-S05` is a historical closure row. Its old short-profile proof bundles were removed when internal installed-user rehearsal moved to skill-agent-only proof, so they must not be used as current acceptance evidence. Current closure evidence for internal installed-user rehearsal starts with catalog-backed full journeys, `installed-user-guided-journey`, and the W25 production-proof fixture.

**Detailed slices:** `docs/backlog/wave-10-implementation-slices.md`

## W11 — target-backed internal installed-user rehearsal proof closure
**Goal:** Make standard internal installed-user rehearsal truly target-backed, profile-driven, and honest enough to serve as production-facing proof.

**Exit criteria:**
- standard internal rehearsal executes against a cloned target checkout rather than the AOR workspace
- preflight executes machine-readable setup and verification commands from the internal installed-user rehearsal profile
- routed live execution invokes the supported external adapter path from the target checkout root
- delivery manifests and release packets anchor repo root and changed paths to the target checkout
- historical target-backed short-profile bundles were removed from current proof evidence; new closure claims must use catalog-backed full journeys with skill-agent decisions

**Detailed slices:** `docs/backlog/wave-11-implementation-slices.md`

## W12 — public-surface removal and installed-user proof conversion
**Goal:** Remove public installed-user rehearsal CLI and contract surfaces, move rehearsal to repo-maintainer-only tooling, and prove the same target scenarios through an internal black-box proof harness.

**Exit criteria:**
- public CLI/help/catalog/contracts no longer expose internal rehearsal command or profile surfaces
- public project-profile examples no longer advertise internal rehearsal defaults
- internal rehearsal runs execute installed-user style through external `aor` subprocesses rather than direct runtime imports
- refreshed proof bundles and runbooks use the installed-user black-box proof harness and no longer depend on removed rehearsal commands

**Closure evidence:**
- installed-user proof harness: internal maintainer runner
- black-box coverage: internal maintainer runner tests
- refreshed operator runbooks: internal maintainer runbooks
- current proof fixtures: internal guided installed-user samples plus `scripts/production-readiness/fixtures/w25-s03-production-proof.json` for the sanitized production-proof fixture

**Detailed slices:** `docs/backlog/wave-12-implementation-slices.md`

## W13 — catalog-backed full-journey internal installed-user rehearsal and quality verdict expansion
**Goal:** Add a full user-journey internal installed-user rehearsal layer on curated public repositories, start each run from a concrete feature mission, and evaluate runtime success plus discovery, artifact, code, delivery, and learning-loop quality through public surfaces.

**Exit criteria:**
- machine-readable target and mission catalog exists under internal maintainer tooling and stays aligned with the internal target-catalog runbook
- `aor project init` can bootstrap a clean target repo without private-tooling-side asset injection
- `aor intake create` and `aor discovery run` can materialize and trace feature-specific mission input
- `aor run start` launches real execution runs rather than control-state-only transitions
- public `review run` and `learning handoff` surfaces produce durable `review-report`, `learning-loop-scorecard`, and `learning-loop-handoff` artifacts
- internal installed-user proof harness supports a mandatory full-journey layer that runs only on curated repos and curated missions
- restored internal runner skill can prepare the feature request, run the public flow, and return a multi-axis verdict matrix

**Detailed slices:** `docs/backlog/wave-13-implementation-slices.md`

## W14 — internal installed-user rehearsal scenario/provider/feature-size matrix
**Goal:** Turn curated full-journey internal installed-user rehearsal into a matrix across scenario family, pinned provider variant, and size-classed feature missions while keeping the matrix curated rather than Cartesian-complete.

**Exit criteria:**
- curated internal installed-user rehearsal catalogs define scenario policies, provider variants, and target missions with explicit `small`, `medium`, and `large` size classes
- full-journey profiles pin `target_catalog_id`, `feature_mission_id`, `scenario_family`, and `provider_variant_id`
- the installed-user proof harness rejects invalid matrix cells and materializes deterministic provider-pinned route overrides for accepted cells
- review, audit, summary, and learning-loop artifacts preserve matrix-cell metadata plus feature-size/provider execution verdicts
- operator docs, runner skill guidance, tests, and proof bundles describe internal installed-user rehearsal as a curated matrix with required repo-specific coverage cells

**Detailed slices:** `docs/backlog/wave-14-implementation-slices.md`

**Current status note:** `W14-S07` is historical matrix-coverage planning context. Its mock-backed `coverage_with_findings` fixture bundle was removed after the internal installed-user rehearsal skill-agent-only migration and must not be used as current acceptance evidence.

## W15 — readiness hardening and proof integrity
**Goal:** Remove false readiness signals after W14 by making source-of-truth drift, package/module map drift, and internal installed-user rehearsal proof scope machine-checkable.

**Exit criteria:**
- W15 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- the module map and workspace manifests agree on all package-managed apps/packages
- root checks fail when stale wave-coverage claims or dishonest proof-bundle claims appear

**Detailed slices:** `docs/backlog/wave-15-implementation-slices.md`

## W16 — implementation complexity reduction
**Goal:** Reduce accumulated implementation complexity after readiness hardening by splitting monolithic runtime surfaces, extracting repeated helpers, and moving adapter permission cleanup through a contract-first path.

**Exit criteria:**
- W16 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- repeated helper logic has package-local shared implementations where behavior is duplicated across runtime modules
- CLI, API, core, contracts, and installed-user proof harness decomposition preserves public command, route, contract, and proof output shapes
- adapter permission legacy fallback fails through explicit permission-policy validation rather than a runtime args fallback

**Detailed slices:** `docs/backlog/wave-16-implementation-slices.md`

## W17 — post-W16 legacy surface cleanup
**Goal:** Remove public compatibility aliases and stale documentation left after W16 decomposition.

**Exit criteria:**
- W17-S01 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- CLI incident outputs expose only the canonical incident report path field
- delivery mode inputs accept only canonical `no-write`, `patch-only`, `local-branch`, and `fork-first-pr` values
- adapter permission legacy wording remains only where documenting or testing unsupported `external_runtime.args`
- docs, examples, internal installed-user rehearsal profiles, and proof fixtures no longer advertise public legacy aliases

**Detailed slices:** `docs/backlog/wave-17-implementation-slices.md`

## W18 — control-plane UI and topology proof gap closure
**Goal:** Close the post-W17 product gaps around connected web full-flow operation, interactive runner question handling, and evidence-backed monorepo plus bounded multirepo support without making the web UI own orchestration logic.

**Exit criteria:**
- W18 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- `requested_interaction` has a contract-backed continuation target for surfacing runner questions, recording operator answers, and resuming or blocking runs through the control plane
- connected web can drive the approved lifecycle through bounded lifecycle command mutations while runtime commands remain the orchestration owners
- the detachable web console has a full-flow backlog path that includes live runner logs/events and interactive answer submission
- monorepo and bounded multirepo support is proven through examples/tests for one project profile with explicit repo graph, impacted repo scope, validation evidence, coordination evidence, and delivery lineage

**Detailed slices:** `docs/backlog/wave-18-implementation-slices.md`

## W19 — story gap traceability and product-quality closure
**Goal:** Convert the user-story gap audit into actionable backlog slices, with traceable coverage evidence before deeper product, discovery, review, learning, and planner work begins.

**Exit criteria:**
- W19 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- the original 112-story working set has stable IDs, tiers, coverage statuses, implementation evidence, and gap slice references
- product intake, discovery research, review decisions, incident backfill, and planner metric gaps have explicit acceptance evidence paths

**Detailed slices:** `docs/backlog/wave-19-implementation-slices.md`


## W20 — production and platform maturity gap closure
**Goal:** Capture remaining production and platform maturity gaps after W19, including multirepo locks, security hardening, OpenCode candidate evidence, compiler revision lifecycle, and finance monitoring.

**Exit criteria:**
- W20 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc
- multirepo scoped locks and cross-repo validation have a bounded backlog path
- production auth, redaction, logging, and observability hardening are separated from local trusted baselines
- OpenCode W20-S03 evidence is treated as historical candidate evidence after W22-S03; required baseline certification awaits future real-runner proof
- compiler revisions and finance monitoring loops have first-class backlog slices

**Detailed slices:** `docs/backlog/wave-20-implementation-slices.md`

## W21 — installed-user onboarding and guided UX closure
**Goal:** Close the gap between implemented command/API/web baselines and a polished installed-user journey that guides an external user from first launch through onboarding, mission intake, next action, optional web operation, review, delivery, release, and learning closure.

**Exit criteria:**
- W21 is represented across the roadmap, master backlog, epic map, dependency graph, story coverage matrix, and owning wave doc
- guided CLI entrypoints make first-run, doctor, onboarding, mission intake, next-action, and app-launch paths discoverable without replacing low-level commands
- clean onboarding supports bundled and explicitly materialized asset modes with project-profile-driven registry roots and durable onboarding reports
- optional web UI mirrors the guided lifecycle while control-plane/runtime commands remain the orchestration source of truth
- final review, delivery, release, and learning stages expose durable evidence, approvals, blockers, and next actions
- an installed-user guided rehearsal proves the journey on a clean repository with no surprise upstream writes

**Detailed slices:** `docs/backlog/wave-21-implementation-slices.md`


## W22 — source-of-truth repair
**Goal:** Repair source-of-truth claims so the repository distinguishes baseline readiness from production readiness and treats OpenCode as extended candidate coverage until real certification exists.

**Exit criteria:**
- Story coverage uses evidence-strength statuses across the original 112 stories.
- Production readiness docs state that the W22 baseline is not yet production-ready and name the W23-W26 release criteria.
- OpenCode is downgraded to extended candidate coverage until real certification exists.

**Detailed slices:** `docs/backlog/wave-22-implementation-slices.md`

## W23 — contracts, auth, and control-plane boundary
**Goal:** Harden contract-first validation, production API auth scopes, and CLI/API lifecycle boundaries before deeper runtime ownership changes.

**Exit criteria:**
- Nested contract validators fail closed for production-critical packets and reports.
- Production-hardened API auth requires explicit permissions.
- CLI and API lifecycle behavior share a service boundary without app-to-app implementation cycles.

**Detailed slices:** `docs/backlog/wave-23-implementation-slices.md`

## W24 — run-level Runtime Harness
**Goal:** Move from step-level harness strength to run-level Runtime Harness ownership for production-grade orchestration decisions.

**Exit criteria:**
- A run-level Runtime Harness controller owns run transitions and closure decisions.
- Interactive continuation has audited requested, answered, resumed, and blocked states.
- Strict code-changing delivery requires current run-level pass evidence and mission-scoped changes.

**Detailed slices:** `docs/backlog/wave-24-implementation-slices.md`

## W25 — real full-journey production proof
**Goal:** Produce the first real non-mock full-journey production proof with code-changing evidence and no upstream writes.

**Exit criteria:**
- A curated real external-runner profile fails closed without auth, permissions, target verification, or no-write safety.
- One curated public target mission passes end to end with real code-changing evidence.
- Production proof fixtures and story upgrades reject mock-backed claims.

**Detailed slices:** `docs/backlog/wave-25-implementation-slices.md`

## W26 — self-hosted production release gate
**Goal:** Make self-hosted production readiness repeatable, reviewable, and documented as a CLI/API production candidate with optional web.

**Exit criteria:**
- A separate production-readiness gate verifies production evidence beyond root baseline checks.
- Production-touched hotspots are stabilized without unrelated redesign.
- Self-hosted CLI/API production candidate docs are complete and bounded to declared non-goals.

**Detailed slices:** `docs/backlog/wave-26-implementation-slices.md`

## W27 — black-box internal installed-user rehearsal step journal
**Goal:** Replace legacy internal installed-user rehearsal post-run matrices with a black-box step journal, resumable interaction answers, explicit profile policies, and updated runner skills.

**Exit criteria:**
- Internal installed-user rehearsal observation reports use ordered `step_journal` entries and reject legacy matrix fields.
- `run answer`, API, and web paths resume recorded interaction boundaries when possible.
- Profiles declare flow range, interaction, frontend, and safety policy.
- Runner summaries link factual run-health reports; outcome quality moves to separate post-run assessment reports.
- Skills, runbooks, proof fixtures, and production-readiness checks align with the new model.

**Detailed slices:** `docs/backlog/wave-27-implementation-slices.md`

## W28 — installed-user rehearsal gap closure and matrix expansion
**Goal:** Add explicit AOR install proof, setup/prelude evidence, full-lifecycle bounded execution, deterministic interaction answer support, evaluator naming cleanup, and expanded curated target coverage.

**Exit criteria:**
- Internal installed-user rehearsal reports include `aor_installation_proof_file` and `setup_journal[]`.
- Full-lifecycle profiles execute release and learning rather than skipping them.
- Step evaluator terminology is separated from Runtime Harness certification.
- Commander.js and pluggy are required matrix targets; Cobra and date-fns were retired from the active matrix by W46 instead of remaining catalog-only candidates.

**Detailed slices:** `docs/backlog/wave-28-implementation-slices.md`

## W29 - npm CLI alpha distribution
**Goal:** Open the first package distribution channel while keeping normal
development on `main` non-publishing and preserving private internal package
boundaries.

**Exit criteria:**
- The root package publishes as `@grinrus/aor` with bin command `aor`.
- Release candidate PRs from `release/v<semver-alpha>` run `pnpm release:gate`.
- Merged release PRs publish only with `release:publish`, matching version, and
  npm Trusted Publishing.
- Docker, GHCR, hosted SaaS, and public SDK package channels remain out of
  scope.

**Detailed slices:** `docs/backlog/wave-29-implementation-slices.md`

## W30 - alpha hardening
**Goal:** Harden the current self-hosted CLI/API alpha with source-of-truth planning, ADRs, an OpenAPI route contract, operations runbooks, readiness checks, and release smoke coverage without starting the target-architecture rewrite.

**Exit criteria:**
- W30 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- Alpha ADRs define the current `.aor` filesystem runtime, hybrid module plus HTTP/SSE API transport, and detachable web boundary.
- The detached API route surface has a machine-readable OpenAPI 3.1 contract and readiness drift check.
- Self-hosted operators have environment, secrets/redaction, backup/restore, and incident evidence runbooks.
- `pnpm production:ready --json` reports W30 evidence and fails closed on missing W30 docs, OpenAPI drift, and dishonest OpenCode status.
- The npm alpha release smoke path proves help, doctor, onboarding, and optional API/web guidance without claiming GA or hosted service readiness.

**Detailed slices:** `docs/backlog/wave-30-implementation-slices.md`

## W31 - installed-user local app launch and onboarding UI
**Goal:** Make `@grinrus/aor` understandable for an installed user by launching a packaged local UI that guides onboarding, Mission intake, next action, blockers, evidence refs, and runtime state without making the web UI mandatory.

**Exit criteria:**
- W31 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- `aor app` starts a foreground local loopback server, opens the browser by default, and exposes smoke mode for release validation.
- The shared HTTP/SSE transport lives in `packages/orchestrator-core`; `apps/api` remains a thin re-export surface.
- The packaged React/Vite SPA works same-origin with `/app-config.json` and `/api/projects/:projectId/**`.
- The Mission form writes existing intake evidence with `delivery-mode=no-write` by default and refreshes `next-action-report`.
- README, product stories, architecture, contracts, ADRs, ops runbooks, packaging, and release smoke docs describe the installed-user UI path.

**Detailed slices:** `docs/backlog/wave-31-implementation-slices.md`

## W32 - operator-request interactive runtime flow
**Goal:** Let operators ask AOR to analyze, explain, revise, repair, validate, plan, implement, or review bounded project artifacts from any flow stage through durable runtime-owned requests rather than direct chat.

**Exit criteria:**
- W32 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- The `operator-request` contract, canonical example, and operator-intervention context rule/bundle are loader-covered.
- CLI, API, and web can create and run operator requests with `delivery_mode=no-write` by default and explicit `patch-only` scope when patches are requested.
- Request runs route through compiled context, produce routed step results, proposal/patch evidence, and refresh `next-action-report`.
- Read/live/web surfaces show sanitized summaries and refs, while raw request text remains only in durable request artifacts.
- Internal installed-user rehearsal docs and fixtures cover no-write analysis, patch-only document proposal, and separation from runtime-initiated interaction answers.

**Detailed slices:** `docs/backlog/wave-32-implementation-slices.md`

## W33 - console flow alignment and post-audit local-alpha repair
**Goal:** Make `aor app` the only product operator console, remove the obsolete static snapshot renderer, and keep the rebased post-audit local-alpha repair slices traceable after W31 and W32.

**Exit criteria:**
- W33 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- `aor app` is documented as the packaged React/Vite local SPA served by a foreground loopback process with same-origin control-plane routes.
- `aor ui attach` and `aor ui detach` remain lifecycle commands, not the main console launch path.
- Internal installed-user rehearsal guided proof captures app-smoke evidence from `aor app --smoke true --open false --json`; generated HTML snapshots are not a proof or console path.
- The local-alpha repair fixes for root gates, runtime-root fidelity, launch guidance, CLI ergonomics, OpenAPI payload depth, runtime read bounds, and web maintainability are mapped to W33 rather than W31/W32 semantics.
- Security, CORS/preflight, hosted deployment, SSO, and production contour hardening remain out of scope.

**Detailed slices:** `docs/backlog/wave-33-implementation-slices.md`

## W34 - flow-centric console refactor and browser-task proof
**Goal:** Refactor the installed-user local console around runtime-owned flow selection, active/completed flow boundaries, closure-to-new-flow behavior, and flow-scoped evidence views, then prove the loop through the current skill-agent-only browser-task internal installed-user rehearsal path.

**Exit criteria:**
- W34 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- Flow product and contract docs define selected, active, completed, and follow-up flows without UI-owned orchestration state.
- Runtime/control-plane surfaces expose flow list, selected-flow details, completed-flow read-only projections, and new-flow lifecycle creation.
- The packaged local SPA implements the accepted W34 design references for flow selector, active cockpit, advanced views, and learning closure.
- Ask AOR, Evidence Graph, Runtime Trace, Interactions Inbox, review, delivery, release, and learning surfaces preserve selected-flow boundaries.
- Release smoke for `aor app --smoke --open false --json` proves the packaged flow-centric bundle still exposes the flow selector and `New Flow` markers.
- Internal installed-user rehearsal uses a guided journey profile with browser-task frontend capability, accepted operator decisions, AOR operator UI evidence refs, no-upstream-write assertions, first-flow completion evidence, a distinct follow-up flow, flow-targeted operator-request proof, and separate post-run quality assessment when outcome quality is evaluated.
- Deleted bounded profiles and mock-backed proof bundles remain out of the current proof path.

**Detailed slices:** `docs/backlog/wave-34-implementation-slices.md`

## W35 - internal installed-user rehearsal operator UX hardening
**Goal:** Make real Codex/Qwen internal installed-user rehearsal operation understandable from the console and operator reports by showing long-running provider heartbeat, automating skill-agent decision artifacts, rendering evidence refs in user-facing form, and proving safe interruption/retry behavior.

**Exit criteria:**
- W35 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- Long-running provider steps expose provider, adapter, step, elapsed time, timeout budget, last output, last artifact update, and recommended safe action in UI and operator reports.
- Silent provider execution is visible as `silent-running` rather than appearing hung.
- Skill-agent operator decisions can be prepared through a helper/UI path that auto-cites required inspected evidence refs.
- Rejected decisions show readable correction guidance and do not require raw JSON editing for the normal path.
- Artifact refs render as concise evidence summaries grouped by flow stage and status, with raw refs available for copy/debug.
- Execution evidence distinguishes mission-relevant changed paths, runtime-owned artifacts, runner-owned state leaks, scratch files, Runtime Harness status, verification status, and no-upstream-write state.
- Stop, diagnose, and retry controls use public control-plane surfaces and preserve partial evidence.
- Codex/Qwen internal installed-user rehearsal UX proof uses current skill-agent-only profiles and does not reintroduce removed bounded or mock-backed proof paths.
- W35-S05 proof closure includes the silent-provider UX fixture, a clean Codex small proof, and a fail-closed Qwen provider blocker with target setup/verification shown separately from provider execution.

**Detailed slices:** `docs/backlog/wave-35-implementation-slices.md`

## W36 - no-settings onboarding and local multi-project UI
**Goal:** Make `aor app` self-guided for an installed user who starts the UI with no setup flags, while allowing several explicitly added local projects in one loopback console without turning that console into hosted portfolio orchestration.

**Exit criteria:**
- W36 is represented across the roadmap, master backlog, epic map, dependency graph, and owning wave doc.
- `aor app` still supports the existing single-project launch contract, but `/app-config.json` also exposes `default_project_id` and `projects[]`.
- The local control-plane exposes `GET /api/projects` for app-session project summaries and dispatches existing `/api/projects/:projectId/**` routes to the matching runtime context.
- The packaged SPA opens to a first-run wizard that shows project context, explicit runtime initialization, first-flow mission intake, and next-action handoff without requiring README setup.
- The top bar includes a project switcher and an add-local-project drawer; projects are added only from explicit user input and keep separate runtime/evidence/flow state.
- Release/app smoke covers wizard, initialize action, project switcher, flow selector, and `New Flow` markers.

**Detailed slices:** `docs/backlog/wave-36-implementation-slices.md`

## W37 - internal installed-user rehearsal target setup closure
**Goal:** Turn the W35-S05 Codex/Qwen blocker into bounded target setup and verification behavior before retrying provider proof, so long-running Playwright or full-suite target checks are visible, budgeted, and fail-closed before any provider-quality conclusion is made.

**Exit criteria:**
- W37 is represented across the roadmap, master backlog, dependency graph, and owning wave doc.
- The `ky` internal installed-user rehearsal target setup path has bounded Playwright/browser dependency handling and does not run unbounded `npm exec playwright install` during baseline diagnostic.
- Target verification separates provider-independent setup blockers from Codex/Qwen provider quality evidence.
- Internal installed-user rehearsal summaries separate AOR runner/controller failures from target repository setup/test/build failures with `failure_owner` and `failure_phase` evidence.
- W37-S01 closure evidence is cited by W35-S05: Codex now closes cleanly and Qwen non-pass is recorded as provider-owned blocker evidence after bounded target setup and verification pass.

**Detailed slices:** `docs/backlog/wave-37-implementation-slices.md`

## W38 - Qwen stream progress adapter closure
**Goal:** Replace Qwen candidate buffered JSON stdout with official stream-json progress so internal installed-user rehearsal operator surfaces can show provider activity before final output.

**Exit criteria:**
- W38 is represented across the roadmap, master backlog, dependency graph, and owning wave doc.
- Qwen candidate adapter profiles use `--output-format stream-json --include-partial-messages` while preserving existing safety, auth, timeout, and request transport behavior.
- Provider heartbeat exposes sanitized Qwen stream progress fields without depending on private `~/.qwen/**` logs.
- Internal installed-user rehearsal summaries and UI distinguish stream-observed provider progress from true `silent-running`.
- Regression tests prove stream JSONL progress prevents false silent-provider UX, malformed lines fail safely, and interrupted runs preserve progress evidence.

**Detailed slices:** `docs/backlog/wave-38-implementation-slices.md`

## W39 - internal installed-user rehearsal provider parity standardization
**Goal:** Make internal installed-user rehearsal provider execution semantics provider-neutral across Codex, Claude, OpenCode, and Qwen while keeping command/auth/progress differences at the adapter boundary.

**Exit criteria:**
- W39 is represented across the roadmap, master backlog, dependency graph, and owning wave doc.
- Internal installed-user rehearsal runbooks define provider parity for public lifecycle, target classification, evidence, Runtime Harness retry/repair, operator decisions, and pass/blocker semantics.
- Provider-pinned policy materialization defaults missing attempt maps to `retry=0` and `repair=0` for provider-backed internal installed-user rehearsal steps.
- Qwen profiles no longer carry provider-only retry/repair lifecycle maps.
- Regression tests prove terminal provider failure preserves evidence without starting internal repair by default.

**Detailed slices:** `docs/backlog/wave-39-implementation-slices.md`

## W40 - post-alpha.7 installed-user and provider qualification hardening
**Goal:** Convert the `0.1.0-alpha.7` release and installed-user smoke findings into the next deterministic backlog wave for onboarding polish, internal installed-user rehearsal in-flight observability, and optional provider qualification without expanding into stable, hosted, Docker/GHCR, or SDK release scope.

**Exit criteria:**
- W40 is represented across the roadmap, master backlog, dependency graph, epic map, and owning wave doc.
- Installed-user docs and smoke guidance distinguish registry package execution from local checkout context so `npm exec --package @grinrus/aor@<version>` remains a reliable proof path.
- The no-settings `aor app` onboarding path has targeted UX hardening for first-run, runtime initialization, first flow, project switching, and readable failure guidance.
- Internal installed-user rehearsal UI/report surfaces show active provider heartbeat/progress while a provider step is still running, not only after terminal evidence lands.
- Release and onboarding docs explain the alpha channel, clean UI launch, no surprise writes, and advanced headless paths in one coherent installed-user story.
- Optional provider qualification tracks Qwen, OpenCode, Claude, and Codex through a matrix that separates coverage tier, auth/environment blockers, target repository blockers, and AOR product failures.

**Detailed slices:** `docs/backlog/wave-40-implementation-slices.md`

## W41 - post-alpha.8 installed-user validation and qualification refresh
**Goal:** Validate the published `0.1.0-alpha.8` package from an installed-user perspective, refresh provider qualification evidence through the standardized internal installed-user rehearsal lifecycle, and convert findings into scoped fixes or backlog follow-up.

**Exit criteria:**
- W41 is represented across the roadmap, master backlog, dependency graph, epic map, and owning wave doc.
- Installed-user smoke starts from the npm registry package in a neutral temp runner and proves help, app smoke, first-run wizard, project switcher, flow selector, `New Flow`, and no implicit runtime creation.
- Browser/UI validation covers clean first-run onboarding, existing-runtime resume, local multi-project switching, readable error states, and first-flow handoff without hosted/SaaS scope.
- Internal installed-user rehearsal qualification refresh uses W39 provider parity and W40 qualification semantics to separate AOR product failures, target repository blockers, provider failures, environment blockers, and operator decisions.
- Findings are either fixed in a scoped slice with tests and evidence or split into new backlog entries with owner, phase, acceptance criteria, and done evidence.
- W41 does not claim stable readiness, another npm release, Docker/GHCR, hosted/SaaS, SDK release, or mandatory Qwen/OpenCode/Claude qualification.

**Detailed slices:** `docs/backlog/wave-41-implementation-slices.md`

## W42 - alpha.9 release and operator interruption classification follow-up
**Goal:** Release the W41 post-alpha.8 user-facing evidence-rendering fix through the npm alpha channel, then address the remaining internal installed-user rehearsal owner/phase clarity finding for operator-initiated provider interruptions.

**Exit criteria:**
- Alpha.9 release prep is queued after W41-S04 and includes only already-merged W41 fixes/docs, without stable/Docker/GHCR/SDK claims.
- Operator-initiated public cancel behavior is replanned as a separate contract-first slice rather than hidden inside release prep.
- The backlog keeps optional provider qualification separate from release-blocking policy.

**Detailed slices:** `docs/backlog/wave-42-implementation-slices.md`

## W43 - post-alpha.10 installed-user and internal installed-user rehearsal confidence refresh
**Goal:** Validate the published `0.1.0-alpha.10` package from installed-user
and internal installed-user rehearsal perspectives, then convert any confidence or readability findings
into scoped follow-up work without mixing release validation with new feature
development.

**Exit criteria:**
- W43 is represented across the roadmap, master backlog, dependency graph, epic map, README pointer, and owning wave doc.
- Installed-user smoke starts from the npm registry package in a neutral temp runner and proves help, app smoke, first-run wizard, project switcher, flow selector, `New Flow`, and no implicit runtime creation.
- Browser/UI validation covers clean first-run onboarding, existing-runtime resume, local multi-project switching, readable evidence/error states, and first-flow handoff.
- Internal installed-user rehearsal smoke verifies that operator-owned provider interruption evidence remains readable in reports/UI and does not hide provider, target repository, environment, or AOR failures.
- Optional Qwen/OpenCode/Claude provider coverage remains non-release-blocking unless a future release policy explicitly changes it.
- Findings are either fixed in a scoped slice with tests and evidence or split into backlog entries with owner, phase, acceptance criteria, and done evidence.

**Detailed slices:** `docs/backlog/wave-43-implementation-slices.md`

## W44 - discovery/research/spec prompt granularity and readiness transitions
**Goal:** Split discovery, research, and spec runtime guidance into
step-specific prompt assets while keeping the shared `artifact` execution class,
then define readiness, blocked, and stale transitions before planning consumes
upstream artifacts.

**Exit criteria:**
- W44 is represented across the roadmap, master backlog, dependency graph, epic
  map, and owning wave doc.
- Source-of-truth docs distinguish workflow steps (`discovery`, `research`,
  `spec`) from execution classes (`artifact`, `planner`, `runner`, `repair`,
  `eval`, `harness`).
- Discovery, research, and spec can resolve distinct prompt bundle refs without
  breaking `prompt_bundle.step_class=artifact` compatibility.
- Readiness evidence defines `pending`, `complete`/`adr_ready`/`ready`,
  `incomplete`, `blocked`, and `stale` transitions through discovery,
  research, spec, and planning.
- Context, skill, and policy overlays are added only after prompt/readiness
  evidence proves that a split is needed.
- W44 closure requires updated README, architecture, contract, ops, and example
  docs plus internal installed-user rehearsal evidence that the implemented flow still works or has
  classified follow-up findings.

**Detailed slices:** `docs/backlog/wave-44-implementation-slices.md`

## W45 - bounded review and QA repair loop
**Goal:** Turn review and QA findings into a bounded cross-stage repair loop
with explicit repair requests, policy budgets, prompt/context lineage,
operator-visible next actions, and replayable proof.

**Exit criteria:**
- W45 is represented across roadmap, master backlog, dependency graph, epic map,
  README pointer, and owning wave doc.
- Review and QA repair findings materialize as one shared quality repair request
  artifact with source gate, finding refs, repair scope, status, evidence refs,
  and cycle-budget metadata.
- The runtime state machine supports
  `implement -> review -> repair -> review -> qa -> repair -> review -> qa`
  without allowing unbounded automatic reruns.
- Repair implementation steps receive source repair request refs through
  compiled prompt/context lineage.
- CLI/API/web surfaces expose open repair requests, attempts used/remaining,
  blocker state, and the single next safe action.
- Proof fixtures and a required post-implementation internal installed-user rehearsal acceptance run
  cover review-origin repair, QA-origin repair, and budget exhaustion.
- Source-of-truth docs are refreshed after implementation and W45 cannot close
  as all-ok without passing internal installed-user rehearsal run refs.

**Detailed slices:** `docs/backlog/wave-45-implementation-slices.md`

## W47 - product internal installed-user rehearsal acceptance closure
**Goal:** Keep the W46 black-box product-quality policy intact while removing
the concrete blockers that prevented all-pass product acceptance: AOR operator
keyboard accessibility, internal installed-user rehearsal target verification contamination, Vitest setup
readiness, and repair/review convergence evidence.

**Exit criteria:**
- Same-commit guided AOR UI proof can pass every required UI/accessibility
  dimension or records a specific blocker.
- `httpx-medium` is product-accepted only after paired final
  `quality-assessment gate --policy all-pass`.
- `fastify-repair-medium` proves public repair convergence or records a more
  specific terminal provider/AOR blocker.
- `vitest-large` no longer fails because `.aor` runtime state is scanned by
  target verification, and setup/environment blockers are classified before
  product execution.
- Runtime artifacts remain uncommitted and blocked proof runs remain
  non-accepted.

**Detailed slices:** `docs/backlog/wave-47-implementation-slices.md`

## W48 - product quality-cycle implementation loop
**Goal:** Extend medium+ product-change rehearsal into the realistic
`execution#N -> review#N -> qa#N` implementation cycle while preserving public
repair boundaries and strict all-pass product acceptance policy.

**Exit criteria:**
- Medium+ profiles declare `cycle_steps: [execution, review, qa]` and all
  supported repair sources.
- Review blockers skip QA and return to public execution repair; QA blockers
  create QA-origin public repair.
- Repair decisions carry structured source phase, iteration, findings,
  changed-path, verification, previous-decision, stop-reason, and next-step
  context.
- Vitest large has explicit target Node policy and fails before product
  execution for incompatible toolchains.
- The W48-specific control proof rerun is reconciled as superseded by stricter
  W49/W50 successor proof evidence; no W48-only product acceptance is claimed.

**Detailed slices:** `docs/backlog/wave-48-implementation-slices.md`

## W49 - quality-cycle proof closure
**Goal:** Remove the remaining W48 proof-quality gaps before claiming any new
product acceptance: repeated repair must fail closed without new actionable
context, QA must have dedicated product-quality dimensions, and the Full Control
proof set must be rerun on one commit.

**Exit criteria:**
- Findings docs distinguish local regression validation from live proof
  acceptance.
- Repair decisions include deterministic fingerprints and new-context signals;
  repeated repair without new evidence terminal-blocks.
- Accepted medium+ `qa#N` step-quality reports include verification relevance,
  regression signal quality, mission relevance, and repair necessity.
- Same-commit Full Control proof runs guided UI, HTTPX medium, Fastify repair,
  and Vitest large or records precise provider/environment blockers.
- Product acceptance is claimed only after final `quality-assessment gate
  --policy all-pass`.

**Detailed slices:** `docs/backlog/wave-49-implementation-slices.md`

## W50 - internal installed-user rehearsal failure closure after W49 control run
**Goal:** Remove the two real W49 blockers without weakening internal installed-user rehearsal quality
gates: Fastify repair should not loop on a broad verification mapping warning
when code and verification pass, and Vitest should fail fast on incompatible
Node before target setup or product execution.

**Exit criteria:**
- Review reports preserve `artifact_quality.verification_coverage` and treat
  broad repo/package test commands as covering changed tests where appropriate.
- Internal installed-user rehearsal review-origin repair starts only for actionable implementation
  repair, not verification-mapping-only warnings with passing verification.
- Profiles with `target_toolchain.node.required_range` stop before target
  install/build/test/lint commands when no compatible Node is available.
- Setup journal preserves `project_bootstrap=pass` when public `project init`
  passed, even if later target readiness blocks.
- Control proof rerun records Fastify/Vitest terminal evidence, and product
  acceptance remains limited to terminal pass plus final all-pass quality gate.

**Detailed slices:** `docs/backlog/wave-50-implementation-slices.md`

## W51 - proof-complete closure and hard-target acceptance
**Goal:** Convert W50's strong implementation and control proof into stricter
clean-commit evidence, obtain a real Vitest large product-acceptance attempt
under a compatible Node toolchain, reduce manual final-quality report assembly,
and make target-readiness blockers first-class.

**Exit criteria:**
- Guided AOR UI, HTTPX medium, and Fastify repair medium are rerun on a clean
  committed SHA, and product acceptance is tied to final all-pass quality gates.
- Vitest large runs with a compatible Node binary or records a new blocker that
  occurs after W50 target-toolchain fail-fast behavior is proven.
- Final quality report drafting is hydrated from public artifacts and cannot
  produce empty all-pass evidence.
- Target setup/toolchain blockers are reported as target-readiness failures
  rather than product execution failures.
- The next hard target is added only after the current large proof policy is
  stable, and optional xlarge remains manual-only.

**Detailed slices:** `docs/backlog/wave-51-implementation-slices.md`

## W52 - remaining hard-target internal installed-user rehearsal acceptance closure
**Goal:** Turn W51's terminal Vitest and SQLAlchemy hard-target evidence into
strict product acceptance where possible, without weakening final all-pass
quality gates or hiding target/environment blockers.

**Exit criteria:**
- Top-level run-health reports preserve target-readiness owner, phase, and
  class when target readiness blocks before product execution.
- Warning-mode diagnostics have bounded timeout and pipe-hang handling so
  terminal command evidence cannot leave internal installed-user rehearsal proof harnesses stuck.
- Vitest large either reaches terminal product flow plus final all-pass quality
  gate, or records a new blocker that is not a W50/W51 setup regression.
- SQLAlchemy large has an explicit full-suite diagnostic policy and either
  reaches final all-pass product acceptance or records a precise target
  diagnostic blocker.
- Findings and backlog distinguish terminal classified evidence from product
  acceptance, and runtime artifacts stay out of git.
- Manual xlarge step-quality reports carry review-grade per-dimension evidence
  instead of generic accepted text.
- Diagnostic command owner/phase/class comes from explicit command metadata, not
  substring matching.
- Final findings include an evidence matrix that separates large product
  acceptance, paired guided UI proof, and manual xlarge observation evidence.

**Detailed slices:** `docs/backlog/wave-52-implementation-slices.md`

## W53 - generic verification core and live E2E boundary
**Goal:** Replace target-specific verification fixes with generic AOR command
groups while keeping live E2E target catalog, run-health, and step-quality
semantics outside orchestrator core.

**Exit criteria:**
- Project profiles, wave tickets, and handoff packets can carry validated
  `verification.command_groups[]` / `verification_plan.command_groups[]`.
- `project verify` normalizes legacy commands into command groups and reports
  required, warning, and observe enforcement separately.
- Live E2E generated target profiles translate catalog verification sugar into
  generic command groups and no longer pass post-run verification through regex
  command bucketing.
- Source guards prevent `packages/**` and `apps/**` production source from
  importing live E2E tooling or emitting live E2E-only fields.
- Generic verifier fixtures cover Node, Python-style setup, monorepo, no-tests,
  and broken-baseline archetypes without depending on the live E2E target
  matrix.

**Detailed slices:** `docs/backlog/wave-53-implementation-slices.md`

## W54 - generic verification authoring and discovery
**Goal:** Make W53 command groups practical for arbitrary projects by adding
authoring contracts, stack discovery, generated project profiles, multi-root
execution semantics, operator-visible plan surfaces, migration examples, real
archetype smoke coverage, and expanded public/private boundary guards.

**Current lane:** After W44 disposition, W54 is the selected implementation lane.
W44/W45 remain valid deferred backlog tracks and are not W54 prerequisites.

**Exit criteria:**
- Command groups can describe working directories, dependencies, detection
  source refs, package managers, tool requirements, skip policy, and generic
  no-tests/missing-tool/not-applicable/broken-baseline outcomes.
- Stack discovery proposes command groups for Node, Python, Go, Rust, frontend
  browser, monorepo, no-tests, and unknown/custom project shapes without
  target-specific logic.
- `project init` can materialize valid default command groups while preserving
  legacy repo command fields as compatibility read models.
- `project verify` honors group working directories, dependency skips,
  missing-tool evidence, timeout classes, hang cleanup, and baseline versus
  post-change status separation.
- CLI, API, and web surfaces expose verification plans and per-group status
  without private proof-harness vocabulary.
- Migration docs and examples teach command groups while proving legacy command
  flags still normalize correctly.
- Archetype smoke coverage proves generic discovery, planning, and verification
  outside private target matrices.
- Boundary guards cover production source, public docs/examples, and AOR
  artifact shapes.

**Detailed slices:** `docs/backlog/wave-54-implementation-slices.md`

## W55 - actionable repair evidence and hard-target control stability
**Goal:** Convert the latest `ky` large/xlarge control findings into generic
repair-evidence, target-catalog, provider-guardrail, and proof-reporting fixes
without reopening W45 or W54.

**Exit criteria:**
- W55 follow-up slices are tracked as a new wave with W45/W54 still done.
- Failed verification review findings include bounded command-level details
  that flow into public `request-repair` decisions and provider repair packets.
- The `ky-request-lifecycle-observability-xlarge` primary command set explicitly
  exercises focused retry lifecycle tests while keeping `npm test` as
  manual/overnight diagnostic warning evidence.
- Claude xlarge execution has auth-compatible compact guardrails and preserves
  provider-owned `provider_context_window_exceeded` evidence.
- Control reruns distinguish known-good medium regression signal, `ky` large
  product/provider outcomes, and manual xlarge observation evidence.

**Detailed slices:** `docs/backlog/wave-55-implementation-slices.md`

## W56 - first-run console focus and cockpit action clarity
**Goal:** Make the installed-user local console first-run and active-flow paths
easier to scan by keeping one safe next action primary while advanced
evidence/debug surfaces stay available through progressive disclosure.

**Exit criteria:**
- Clean first-run and initialized-without-flow screens prioritize the runtime
  initialization or first-flow setup action without showing empty advanced
  evidence panels as primary content.
- CTA copy distinguishes configuring a first flow from creating durable mission
  evidence and resolving the first next action.
- Disabled flow-dependent controls explain what state is required to recover.
- Mobile first-run layout keeps project, status, stage progress, and primary
  action within the viewport without horizontal overflow.
- Active-flow desktop, tablet, and mobile layouts keep selected project, flow,
  no-write safety, and `Resolve Next Action` reachable before advanced evidence
  workbench content.

**Detailed slices:** `docs/backlog/wave-56-implementation-slices.md`

## W57 - execution trust and data-integrity recovery
**Goal:** Convert the July 2026 codebase audit into contract-first repairs for
release honesty, identifiers and scope, no-write/workspace isolation, runtime
permissions, exact delivery authorization, transactional initialization, and
concurrent evidence identity.

**Current lane:** W57-S01 is the only ready slice. Credentialed live execution
and write-capable delivery remain outside the supported release claim until W57
closure evidence exists.

**Exit criteria:**
- The local app threat model is loopback-only and same-origin; hosted frontend
  security remains an explicit future ADR scope.
- No-write execution cannot modify the primary checkout and all execution roots
  have independent Git metadata.
- Identifiers, roots, scopes, permission grants, and delivery evidence fail
  closed for traversal, collision, malformed, stale, cross-run, and extra-path
  cases.
- Initialization and concurrent attempt/run/event writes preserve complete,
  immutable, idempotent evidence.
- All tracked tests are discovered and W57 safety regressions are stable on the
  supported Node 22 environment.

**Detailed slices:** `docs/backlog/wave-57-implementation-slices.md`

## W58 - runtime, quality, and loopback control-plane truthfulness
**Goal:** Make queries non-materializing, context/evaluation evidence effective,
routing and policy semantics executable, run lifecycle asynchronous, live events
cross-process, API/CLI/OpenAPI surfaces canonical, and the local loopback HTTP
boundary safe without introducing hosted frontend scope.

**Exit criteria:**
- Every read/query operation leaves a clean project unchanged until an explicit
  initialization mutation.
- Effective context content and hashes reach the provider; real evaluation,
  run-owned Harness lineage, and replay compatibility fail closed.
- Route fallback/retry/repair and adapter semantic normalization execute the
  declared policy instead of descriptive metadata only.
- Active runs leave HTTP/SSE/CLI controls responsive and deliver durable events
  between worker, server, CLI, and local SPA processes.
- API exports, OpenAPI fixtures, CLI flags, limits, redaction, and lifecycle
  dependencies agree.
- `aor app` rejects non-loopback, hostile Host/Origin, wrong media type, and
  oversized body requests without requiring browser login or hosted auth.

**Detailed slices:** `docs/backlog/wave-58-implementation-slices.md`

## W59 - local operator correctness, maintainability, and audit closure
**Goal:** Replace marker-based web confidence with executable browser behavior,
fix local console state/queue/accessibility defects, introduce code-quality and
dependency ratchets, decompose proven hotspots, enforce public/private contract
parity, and independently close the audit.

**Exit criteria:**
- The installed SPA is tested through clean first load, live/reconnect, project
  race, partial failure, multi-item queue, responsive, and keyboard scenarios.
- The local console uses one same-origin client and atomic snapshot state without
  remote/hosted frontend assumptions.
- Scoped lint/type/dependency/dead-code/complexity/duplication gates prevent new
  debt while supporting incremental cleanup.
- Core, CLI, control-plane, adapter, web, and live-E2E hotspots are decomposed
  behind characterization tests and contract-parity guards.
- Every AUD-001 through AUD-055 item has independent evidence or an explicit
  accepted/open disposition, and readiness/story/release claims match the result.

**Detailed slices:** `docs/backlog/wave-59-implementation-slices.md`

## W60 - structured task planning and operator workbench
**Goal:** Replace generic task lists with structured, versioned, and
execution-ready plans whose scope, dependencies, acceptance coverage,
verification, evidence, attempts, and completion remain inspectable through
headless and web surfaces.

**Exit criteria:**
- medium+ wave tickets and handoffs carry complete structured tasks while old
  compact task records remain compatible;
- deterministic completeness and traceability validation runs before semantic
  task-quality evaluation or approval;
- planner output is mission-specific instead of the same generic implementation,
  verification, and lineage task trio;
- execution plans distinguish stable tasks, grouped units, and repeated attempts;
- the Plan workbench exposes details, dependencies, criteria coverage, revisions,
  approval, progress, and recovery without UI-owned state;
- public proof covers revision, approval, task-to-unit mapping, retry under one
  task ID, and evidence-derived completion.

**Detailed slices:** `docs/backlog/wave-60-implementation-slices.md`

## W61 - project topology, bindings, and management UX
**Goal:** Make single-repo, monorepo, and bounded multirepo projects explicitly
configurable through portable topology plus machine-local bindings, with
headless management and an installed-user Project Structure experience.

**Exit criteria:**
- product and architecture distinguish Local Workspace, AOR Project,
  Repository, Component, Project Binding, and Workspace Set;
- portable profiles never require machine-local absolute paths and monorepo
  packages remain components of one physical repository;
- explicitly connected projects and bindings persist across app restart without
  filesystem scanning or implicit runtime initialization;
- CLI/API/UI support topology create/import, add/edit/rebind/disable,
  reanalysis, validation, and recoverable blocker states;
- single-project no-settings launch and current profiles stay compatible;
- installed-user proof covers all supported topologies, persistence, rebind,
  accessibility, responsive behavior, and project isolation.

**Detailed slices:** `docs/backlog/wave-61-implementation-slices.md`

## W62 - repo-aware execution and coordinated delivery
**Goal:** Execute approved task DAGs through exact run-scoped repository
workspaces, bounded parent/child concurrency, aggregate integration and repair,
and truthful per-repository coordinated delivery.

**Exit criteria:**
- delivery-capable runs provision workspace sets with stable mounts, refs,
  commits, cleanup, and per-repository Git/change evidence;
- approved tasks map to a validated execution DAG with deterministic conflict
  and concurrency decisions;
- child attempts use normal Runtime Harness execution and never make partial
  parent success look complete;
- failed child or integration work preserves accepted evidence, invalidates only
  affected downstream work, and reuses bounded W45 repair semantics;
- integration, review, QA, locks, delivery plan, and delivery manifest close one
  aggregate mission with explicit partial-delivery recovery;
- monorepo and bounded multirepo proof covers sequential, parallel, serialized
  conflict, failure/repair, integration, operator UX, and no-upstream-write truth.

**Detailed slices:** `docs/backlog/wave-62-implementation-slices.md`

## W63 - operator-console UX and UI maturity
**Goal:** Consolidate the installed local console after structured planning,
topology, and repo-aware delivery land, so an operator can create or resume a
Mission, take one truthful next action, recover safely, and inspect evidence on
desktop or mobile without terminal-only ambiguity.

**Exit criteria:**
- the operator journey, action taxonomy, deterministic scenario catalog, and
  contract ownership are explicit before UI changes land;
- semantic tokens and reusable component contracts cover type, density,
  interaction, focus, loading, empty, error, blocked, and permission states;
- Mission intake prevents accidental blank creation while preserving the
  explicit incomplete-Mission path and resumable create-to-next flow;
- cockpit actions derive from canonical contracts rather than parsed command
  strings, and recovery always names the outcome it will request;
- adaptive navigation preserves the active flow, safety state, and next action
  from compact mobile widths through desktop, with keyboard and zoom/reflow
  coverage;
- installed-package browser, accessibility, screenshot, and story evidence
  proves the completed journey without creating upstream writes.

**Detailed slices:** `docs/backlog/wave-63-implementation-slices.md`
## Planning rule
The roadmap is tracked as **wave → epic → slice → local task**. Shared backlog docs hold waves, epics, and slices. Local tasks live inside the owning wave document and can be refined branch-locally without creating new shared backlog items unless the scope becomes a new independently acceptable outcome.
