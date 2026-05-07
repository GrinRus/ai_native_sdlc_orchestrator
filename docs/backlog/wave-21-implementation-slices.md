# W21 implementation slices

## Wave objective
Close the installed-user onboarding and guided UX gap so an external user can install AOR, connect a repository, define a mission, follow the next safe action, use the optional web app, and understand review, delivery, release, and learning closure without reading internal implementation docs first.

## Wave exit criteria
- W21 is represented across the roadmap, master backlog, epic map, dependency graph, story coverage matrix, and owning wave doc.
- Public guided command vocabulary exists for first-run, onboarding, mission intake, next-action, and app launch surfaces while existing low-level commands remain stable.
- Clean project onboarding supports bundled and explicitly materialized asset modes with project-profile-driven registry roots and durable onboarding reports.
- Optional web UI mirrors the guided lifecycle through control-plane/runtime-owned state rather than UI-owned orchestration.
- One installed-user guided journey rehearsal proves the flow on a clean repository with public-repo safety defaults and no surprise upstream writes.

## Sequencing notes
- `W21-S01` starts after `W19-S01` because the installed-user journey must be traceable to stable story IDs and coverage evidence.
- `W21-S02` and `W21-S03` split first-run CLI entrypoints from project onboarding internals so installability can progress without hiding asset-root behavior.
- `W21-S04` depends on `W19-S02` and `W21-S03` because mission intake needs the product-intake model plus clean onboarding evidence.
- `W21-S05` depends on `W18-S03` and `W21-S04` so the web app builds on connected lifecycle mutations and the guided mission state.
- `W21-S06` depends on `W19-S05` and `W21-S05` so review approvals and final closure are durable before the guided UI exposes them.
- `W21-S07` closes the wave only after CLI, onboarding, mission, web, and closure UX slices can be rehearsed together.

---

## W21-S01 — Installed-user onboarding UX contract
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Define the installed-user journey contract and backlog narrative for install, doctor, onboard, mission intake, next action, web attach, review, delivery, release, and learning closure.
- **Primary modules:** `docs/product/**`, `docs/contracts/**`, `docs/architecture/**`, `docs/backlog/**`
- **Hard dependencies:** W19-S01
- **Primary user-story surfaces:** product sponsor / owner, project bootstrap / onboarding, operator / SRE, reviewer / QA

### Local tasks
1. Define the guided stage model, command vocabulary, report expectations, UI state model, and no-upstream-write defaults.
2. Update product and architecture docs so installed-user onboarding is a first-class journey rather than a list of independent commands.
3. Identify the minimum contracts that need additive fields for onboarding reports, asset mode, mission intake, and lifecycle state.
4. Align story coverage rows for installed-user onboarding and guided UI gaps with W21 slice ownership.
5. Keep low-level command contracts and headless-first operation explicitly compatible.

### Acceptance criteria
1. The installed-user journey has a single source-of-truth narrative from installation through learning closure.
2. Guided commands and web stages are documented as additive surfaces over existing runtime-owned commands.
3. No-upstream-write, bounded execution, and public-repo safety defaults are explicit in the journey contract.
4. Story coverage rows reference W21 for installed-user onboarding and guided UI gaps.
5. Contract/reference checks pass for any changed examples or loader-covered docs.

### Done evidence
- installed-user onboarding UX contract or source-of-truth narrative
- updated product, architecture, backlog, and story coverage references
- passing targeted contract/reference checks

### Out of scope
- implementing CLI shortcuts
- implementing web UI screens
- changing existing low-level command output shapes

---

## W21-S02 — Installable CLI and first-run entrypoints
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Make AOR understandable from first launch by adding guided public entrypoints for doctor, onboarding, app launch, and next-action discovery.
- **Primary modules:** `package.json`, `apps/cli`, `docs/architecture/**`, `docs/ops/**`, tests
- **Hard dependencies:** W21-S01
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, delivery engineer

### Local tasks
1. Add installable/root entrypoint behavior so `aor` and `aor --help` work in installed-user style contexts.
2. Add guided shortcuts for `aor doctor`, `aor onboard <repo>`, `aor app`, and `aor next`.
3. Keep existing grouped commands available and document guided shortcuts as wrappers, not replacements.
4. Make human-readable output the default for guided commands while preserving machine-readable output where current commands support it.
5. Add CLI help, parser, and installed-user smoke tests.

### Acceptance criteria
1. A clean installed-user invocation can discover the guided first-run commands from `aor --help`.
2. Guided shortcuts dispatch without breaking existing `<group> <verb>` commands.
3. `aor doctor` reports environment readiness and actionable blockers.
4. `aor app` can direct the user to the optional web surface without making web mandatory.
5. CLI tests cover help output, shortcut parsing, and compatibility with existing command groups.

### Done evidence
- CLI entrypoint/help tests
- updated command catalog or operator docs
- installed-user smoke transcript for first-run commands

### Out of scope
- publishing packages to a public registry
- removing or renaming existing commands
- production desktop app packaging

---

## W21-S03 — Clean project onboarding and asset-root resolution
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Allow `aor onboard <repo>` to prepare a clean target repository without mandatory example-copy materialization, while still supporting explicit asset ejection when requested.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, `examples/**`, tests
- **Hard dependencies:** W21-S01
- **Primary user-story surfaces:** project bootstrap / onboarding, product sponsor / owner, architect / tech lead

### Local tasks
1. Define `asset_mode: bundled | materialized` and project-profile-driven registry-root resolution before runtime changes depend on them.
2. Add an onboarding report that records detected project state, asset mode, readiness, blockers, and next recommended action.
3. Update onboarding runtime paths so bundled assets can be resolved without copying examples into the target repository.
4. Keep explicit materialization/eject behavior available for users who want committed AOR assets.
5. Add tests for bundled, materialized, missing-profile, and blocked-onboarding scenarios.

### Acceptance criteria
1. Clean onboarding can run without committing `.aor/` runtime state or copied example registries into the target repository.
2. Project-profile registry roots are honored consistently by analysis, validation, route, wrapper, prompt, policy, and context loading paths.
3. The onboarding report explains readiness, blockers, asset mode, and next action in durable artifact form.
4. Materialized asset mode is explicit and does not become the default by accident.
5. Tests cover clean temp-repo onboarding in bundled and materialized modes.

### Done evidence
- updated project-profile and onboarding-report contract docs/examples
- CLI/core tests for asset-root resolution modes
- onboarding transcript showing no surprise target-repo writes

### Out of scope
- external template marketplace support
- automatic upstream commits of AOR assets
- changing runtime output ownership outside `.aor/`

---

## W21-S04 — Guided mission intake and next-action resolver
- **Epic:** EPIC-2 Packet lifecycle
- **State:** done
- **Outcome:** Let users define a mission with goals, KPI/DoD, constraints, allowed paths, and delivery mode, then receive the next safe action for the current project state.
- **Primary modules:** `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core`, `apps/cli`, tests
- **Hard dependencies:** W19-S02, W21-S03
- **Primary user-story surfaces:** product sponsor / owner, engineering manager / planner, project bootstrap / onboarding, delivery engineer

### Local tasks
1. Extend mission/intake docs and contracts with guided goals, KPI/DoD, source refs, allowed paths, constraints, and delivery mode.
2. Implement `aor mission create` as an additive guided surface over the existing intake/runtime packet path.
3. Implement `aor next` as a deterministic resolver for ready, blocked, incomplete, and already-running project states.
4. Ensure next-action output links to durable packets, reports, blockers, and exact follow-up commands.
5. Add tests for complete mission input, missing KPI/DoD, blocked prerequisites, and safe delivery-mode recommendations.

### Acceptance criteria
1. Mission intake creates durable packet evidence that preserves goals, constraints, KPI/DoD, source refs, allowed paths, and delivery mode.
2. `aor next` produces one primary next action with explainable blockers and supporting evidence refs.
3. Bounded execution and write-back policy remain explicit before any delivery-capable action.
4. CLI/runtime tests cover ready, blocked, partial, and invalid mission states.

### Done evidence
- mission intake contract/docs/examples
- CLI/runtime tests for `mission create` and `next`
- sample next-action transcript linked to onboarding evidence

### Out of scope
- live SaaS connector ingestion
- autonomous issue triage from remote services
- unbounded multi-project planning

---

## W21-S05 — Guided web app full-flow console
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Make the optional web UI mirror the guided CLI journey from readiness through mission, discovery/spec/plan, execution, review/QA, delivery/release, and learning.
- **Primary modules:** `apps/web`, `apps/api`, `docs/ops/**`, tests
- **Hard dependencies:** W18-S03, W21-S04
- **Primary user-story surfaces:** product sponsor / owner, reviewer / QA, delivery engineer, operator / SRE

### Local tasks
1. Add guided stage views for readiness, mission, discovery/spec/plan, execution, review/QA, delivery/release, and learning.
2. Drive mutations through control-plane/runtime-owned lifecycle APIs rather than duplicating orchestration in the web app.
3. Show evidence, blockers, policy state, logs/events, and exact next actions on each stage.
4. Keep disconnected/read-only and detach behavior explicit for headless-first operation.
5. Add web/API smoke tests for connected success, blocked state, reconnect, and detach behavior.

### Acceptance criteria
1. The web console can progress through the guided lifecycle using control-plane mutation surfaces.
2. Every stage exposes what happened, why it is safe or blocked, where evidence lives, and what the next action is.
3. Web detach does not stop or mutate the underlying run unexpectedly.
4. Read-only mode remains usable when mutation transport is unavailable.
5. Web/API tests cover full-flow progress and blocked-stage rendering.

### Done evidence
- web full-flow smoke fixture or screenshot evidence
- API/web tests for guided lifecycle stages
- updated connected web runbook

### Out of scope
- making web mandatory for runtime operation
- hosted SaaS deployment
- production visual-design system overhaul beyond the guided flow

---

## W21-S06 — Review, delivery, release, and learning closure UX
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Make the final guided steps understandable and evidence-backed for review decisions, delivery readiness, release packets, and learning-loop handoff.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `apps/api`, `apps/web`, `docs/ops/**`, tests
- **Hard dependencies:** W19-S05, W21-S05
- **Primary user-story surfaces:** product sponsor / owner, reviewer / QA, delivery engineer, operator / SRE, delivery transaction / Git / PR flow

### Local tasks
1. Connect review decisions, quality evidence, handoff approval, delivery preparation, release preparation, and learning handoff into the guided stage model.
2. Ensure approvals, holds, repair requests, blocked states, and release readiness are durable artifacts rather than UI-only state.
3. Add CLI/API/web output paths that explain final-stage blockers and evidence refs consistently.
4. Preserve validation-before-evaluation and review-before-risky-delivery semantics.
5. Add tests for approve, hold, request-repair, blocked-delivery, release-ready, and learning-handoff branches.

### Acceptance criteria
1. Guided closure stages expose current decision state, required evidence, downstream safety gates, and exact next action.
2. Risky delivery or release preparation is blocked when required review or approval artifacts are missing.
3. CLI/API/web surfaces agree on final-stage evidence refs and blocked reasons.
4. Learning handoff links back to the same review, quality, delivery, and release evidence chain.

### Done evidence
- final-stage contract/docs/runbook updates
- CLI/API/web tests for guided closure branches
- sample closure transcript with review, delivery, release, and learning artifacts

### Out of scope
- bypassing deterministic validation before review
- direct upstream writes by default
- replacing existing delivery/release command ownership

---

## W21-S07 — Installed-user guided journey proof
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Prove the installed-user guided journey end to end on a clean repository with public-repo safety defaults.
- **Primary modules:** `scripts/live-e2e/**`, `examples/live-e2e/**`, `docs/ops/**`, `apps/cli`, `apps/web`, tests
- **Hard dependencies:** W21-S02, W21-S03, W21-S04, W21-S05, W21-S06
- **Primary user-story surfaces:** project bootstrap / onboarding, product sponsor / owner, reviewer / QA, operator / SRE, delivery transaction / Git / PR flow

### Local tasks
1. Add an installed-user guided proof profile that starts from first-run CLI entrypoints on a clean target repository.
2. Capture CLI transcript evidence for doctor, onboard, mission create, next, guided execution, review, delivery/release, and learning closure.
3. Capture web smoke or screenshot evidence for the same stage model where connected web is enabled.
4. Assert `.aor/` runtime-state ownership, no surprise committed target files, and no upstream writes by default.
5. Publish proof fixtures and runbook guidance for pass, blocked, and partial-readiness branches.

### Acceptance criteria
1. A clean-repo guided rehearsal can be reproduced from documented installed-user commands.
2. Proof evidence includes CLI transcript, web smoke/screenshot evidence, generated packets/reports, and blocked/no-write assertions.
3. Public-repo safety defaults are visible in the proof output and fail closed when prerequisites are missing.
4. The proof runner and tests reject narrative-only success claims without durable artifacts.
5. Root checks and targeted live-E2E proof tests pass.

### Done evidence
- installed-user guided journey proof fixture
- CLI transcript and web smoke/screenshot evidence
- updated live-E2E/operator runbook

### Out of scope
- proving unbounded production write-back
- hosted SaaS onboarding
- replacing the curated target catalog with arbitrary internet repositories
