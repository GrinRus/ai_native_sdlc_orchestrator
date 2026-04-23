# W11 implementation slices

## Wave objective
Close the reopened target-catalog proof gap by making standard live E2E target-backed, profile-driven, and honest enough to serve as production-facing readiness evidence.

## Wave exit criteria
- standard `live-e2e` executes against a cloned target checkout rather than the AOR workspace
- preflight executes machine-readable setup and verification commands from the live E2E profile
- routed live execution invokes the supported external adapter path from the target checkout root
- delivery manifests and release packets anchor repo root and changed paths to the target checkout
- fresh `regress-short` and `release-short` evidence bundles prove the target-backed flow without narrative-only assumptions

## Parallel start and sequencing notes
- `W11-S01` starts immediately because the source-of-truth docs and backlog must reflect the reopened proof gap before more runtime work is queued.
- `W11-S02` materializes the target checkout and generated project profile first so later execution and delivery work stop depending on AOR-local examples.
- `W11-S03` and `W11-S04` stay sequential because live preflight and routed execution must become target-root aware before delivery evidence can anchor itself to target checkout paths.
- `W11-S05` closes the wave only after fresh short-profile target-backed evidence exists for both regression and release-shaped catalog runs.

---

## W11-S01 — Source-of-truth reality repair
- **Epic:** EPIC-0 Repository development system
- **State:** ready
- **Outcome:** Align current-state backlog, README, and related planning surfaces with the verified repository behavior so the repo no longer overclaims target-backed proof or live multi-runner support.
- **Primary modules:** `README.md`, `docs/backlog/**`, `docs/product/**`, `docs/ops/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** operator / SRE, delivery engineer, AI platform owner

### Local tasks
1. Narrow current-state docs so they describe the verified live runtime honestly.
2. Record that live execution currently supports `codex-cli` only and that standard target-catalog proof is not yet target-backed.
3. Add the W11 wave to the shared planning model and keep `W10-S05` blocked until target-backed proof exists.
4. Recheck roadmap, wave docs, and source-of-truth entry docs for drift after the repair.

### Acceptance criteria
1. No current-state doc claims target-catalog proof that still relies on AOR-workspace-backed delivery evidence.
2. No current-state doc describes `claude-code` or `open-code` as currently supported live adapters.
3. The roadmap, master backlog, epic map, dependency graph, and wave docs agree on the reopened proof gap and the W11 closure plan.
4. Root backlog checks pass after the planning-model repair.

### Done evidence
- updated entry and backlog docs that describe the live-execution baseline honestly
- synchronized roadmap, wave, backlog, and dependency-graph references for W11
- passing slice-cycle integrity checks after the source-of-truth repair

### Out of scope
- implementing a second live adapter
- refreshing external proof fixtures in the same slice

---

## W11-S02 — Target workspace materialization for live E2E
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Make `live-e2e start` clone the profile target repository into a run-scoped isolated workspace and generate a run-scoped project profile from the declared template reference.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**`
- **Hard dependencies:** W11-S01
- **Primary user-story surfaces:** operator / SRE, delivery engineer, project bootstrap / onboarding

### Local tasks
1. Clone and checkout `target_repo.repo_url` plus `target_repo.ref` into a run-scoped isolated workspace.
2. Generate a run-scoped project profile under the runtime root without mutating the target repository checkout.
3. Hydrate repo, build, lint, and test settings from `verification.*` fields in the live E2E profile.
4. Update docs and tests for the new target-checkout materialization path.

### Acceptance criteria
1. Run summaries include `target_checkout_root` and `generated_project_profile_file`.
2. `project init`, `analyze`, `validate`, and `verify` execute against the cloned target root rather than the AOR workspace.
3. Standard `live-e2e` no longer depends on `examples/**` existing inside the target repository.
4. Tests cover clone or checkout setup, generated profile hydration, and failure handling for invalid target refs.

### Done evidence
- test coverage for target checkout creation and generated project profile hydration
- run summary fixture showing `target_checkout_root` and `generated_project_profile_file`
- updated live E2E docs describing target-workspace setup and isolation behavior

### Out of scope
- broad target-catalog expansion
- networked upstream delivery writes

---

## W11-S03 — Profile-driven preflight and routed live execution
- **Epic:** EPIC-3 Routed execution
- **State:** blocked
- **Outcome:** Make the standard live E2E execution stage use profile-defined verification commands and the supported external adapter path from the target checkout root.
- **Primary modules:** `apps/cli`, `packages/adapter-sdk`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**`
- **Hard dependencies:** W11-S02
- **Primary user-story surfaces:** delivery engineer, operator / SRE, security / compliance

### Local tasks
1. Execute `verification.setup_commands` and `verification.commands` inside the cloned target checkout during preflight.
2. Pass an explicit execution root through the live adapter and routed execution path instead of relying on process cwd.
3. Persist routed step, compiled-context, and raw adapter evidence for successful target-backed runs.
4. Cover success, missing-prerequisite, and policy-blocked branches in docs and tests.

### Acceptance criteria
1. Successful target-backed runs record routed step results, compiled-context references, and raw adapter evidence references in the run summary.
2. Missing external runners block the run with `missing-prerequisite` semantics rather than falling through to a mock-only success path.
3. Short proof profiles no longer pass through a mock-only execution path.
4. Tests cover target-root command execution, explicit execution-root adapter invocation, and blocked failure branches.

### Done evidence
- tests for profile-driven verification command execution and explicit adapter execution roots
- target-backed run summary or fixture linking step, context, and raw adapter evidence
- updated runbooks for success, missing-prerequisite, and policy-blocked live execution branches

### Out of scope
- adding live support for a second external adapter
- widening detached transport scope

---

## W11-S04 — Target-anchored delivery and release evidence
- **Epic:** EPIC-5 Delivery and release
- **State:** blocked
- **Outcome:** Make delivery and release proof anchor itself to the target checkout rather than to artificial changes in the AOR repository.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `packages/observability`, `docs/contracts/**`, `examples/live-e2e/**`, `docs/ops/**`
- **Hard dependencies:** W11-S03
- **Primary user-story surfaces:** delivery engineer, delivery transaction / Git / PR flow, finance / audit / hygiene

### Local tasks
1. Remove the rehearsal-only hack that appends changes to `examples/project.aor.yaml` during live E2E release-shaped runs.
2. Thread target checkout provenance through the delivery driver and release artifact materialization path.
3. Anchor delivery manifests and release packets to target repo roots and target changed paths.
4. Add tests and doc updates for target-root delivery evidence and lineage.

### Acceptance criteria
1. `delivery-manifest.repo_deliveries[].changed_paths` points only to files under the exercised target repository.
2. Proof fixtures no longer treat `docs/backlog/**` or `examples/project.aor.yaml` as delivery output for target-catalog rehearsals.
3. Delivery and release artifacts capture replayable target-checkout provenance.
4. Tests cover target-root manifest lineage and delivery evidence generation.

### Done evidence
- tests proving target-root delivery-manifest and release-packet lineage
- refreshed target-backed delivery-manifest or release-packet fixture
- updated live E2E and delivery docs showing target-anchored evidence semantics

### Out of scope
- release publication to package registries
- upstream direct writes to public repositories

---

## W11-S05 — Fresh external proof bundle for catalog targets
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** blocked
- **Outcome:** Refresh the catalog proof bundle so it demonstrates target-backed execution and delivery for the short regression and short release profiles.
- **Primary modules:** `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`, `docs/backlog/**`
- **Hard dependencies:** W11-S04
- **Primary user-story surfaces:** operator / SRE, delivery engineer, finance / audit / hygiene

### Local tasks
1. Run fresh `regress-short` and `release-short` target-backed rehearsals through the supported external adapter path.
2. Capture refreshed fixtures, scorecards, manifests, incident or learning-loop artifacts, and supporting transcripts under `examples/live-e2e/fixtures/**`.
3. Update runbooks and the dependency matrix with observed prerequisites, failure signatures, and safety defaults from the fresh runs.
4. Link the refreshed proof bundle back to W11 and W10 closure criteria.

### Acceptance criteria
1. Both `regress-short` and `release-short` use a real target checkout rather than the AOR workspace.
2. The evidence bundle includes raw adapter execution evidence, target-root delivery evidence, and linked learning-loop artifacts.
3. Runbooks cite the refreshed fixtures as the canonical proof bundle for the short catalog profiles.
4. The resulting evidence is sufficient to unblock and close `W10-S05` without narrative-only assumptions.

### Done evidence
- refreshed `regress-short` and `release-short` fixtures with target-backed run summaries and delivery evidence
- updated runbooks and dependency matrix entries pointing at the refreshed canonical bundle
- backlog references linking W11 closure evidence to W10 proof closure

### Out of scope
- long-profile proof refresh in the same slice
- broad catalog expansion beyond the short proof set
