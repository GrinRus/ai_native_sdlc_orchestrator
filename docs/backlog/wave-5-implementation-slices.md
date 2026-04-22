# W5 implementation slices

## Wave objective
Expose operator-grade APIs, live views, and standardized live E2E orchestration for the full control plane.

## Wave exit criteria
- the control plane exposes read APIs for project state, packets, runs, and quality evidence
- live run events stream through a stable event model usable by CLI and web surfaces
- CLI and detachable web UI can inspect runs and perform bounded interventions
- standard live E2E profiles execute through the same control plane used for product features
- scorecards, incident capture, and learning-loop outputs are durable artifacts

## Parallel start and sequencing notes
- `W5-S03` and `W5-S04` can develop in parallel after the read API and live stream exist.
- `W5-S05` standardizes the end-to-end control-plane orchestration across the selected public targets.
- `W5-S06` closes the loop by turning live E2E output into reusable quality and planning input.

---

## W5-S01 — Control plane API read surface
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Expose project state, packets, runs, and quality evidence through a stable read API before adding live control features.
- **Primary modules:** `apps/api`, `packages/orchestrator-core`, `packages/contracts`
- **Hard dependencies:** W4-S05, W2-S05
- **Primary user-story surfaces:** operator / SRE, AI platform owner, web surface developer

### Local tasks
1. Expose read APIs for projects, runtime state, packets, step results, manifests, and promotion decisions.
2. Reuse the same contract families already used by CLI and runtime artifacts.
3. Document authentication and permission assumptions for the API surface.
4. Add smoke tests for the first read endpoints.

### Acceptance criteria
1. The API can read project state, packets, runs, and quality artifacts without bespoke file scraping.
2. Read responses reuse existing contract families rather than inventing parallel API-only shapes.
3. Authentication and permission assumptions are documented clearly.
4. Smoke tests cover the initial read endpoints.

### Done evidence
- API smoke tests
- read-response fixtures
- updated API contract docs

### Out of scope
- live event streaming
- write or intervention endpoints

---

## W5-S02 — Live run event stream
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Stream run events through a stable event model so operators can follow progress without tailing raw files.
- **Primary modules:** `apps/api`, `packages/observability`, `docs/contracts/**`
- **Hard dependencies:** W5-S01, W2-S05
- **Primary user-story surfaces:** operator / SRE, web surface developer, AI platform owner

### Local tasks
1. Define a stable live-run event contract for run start, step updates, evidence links, warnings, and terminal states.
2. Expose an SSE or equivalent streaming path backed by runtime events.
3. Guarantee replay-safe event ordering for one run stream.
4. Document backpressure and reconnect expectations.

### Acceptance criteria
1. Operators can subscribe to a stable live-run event stream instead of inspecting raw runtime files directly.
2. Run start, step updates, evidence links, warnings, and terminal states use one shared event contract.
3. Event ordering for a single run is stable enough for CLI and web consumers.
4. Reconnect and backpressure behavior is documented.

### Done evidence
- event-stream smoke tests
- live-run event fixtures
- updated realtime operations docs

### Out of scope
- web UI rendering
- operator intervention controls

---

## W5-S03 — CLI operator commands beyond bootstrap
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Expand the CLI from bootstrap-only flows into an operator tool for inspecting and controlling bounded runs.
- **Primary modules:** `apps/cli`, `apps/api`, `docs/architecture/**`
- **Hard dependencies:** W5-S01, W5-S02
- **Primary user-story surfaces:** operator / SRE, delivery engineer, reviewer / QA

### Local tasks
1. Add CLI commands for listing runs, inspecting artifacts, following live events, and viewing delivery evidence.
2. Reuse the API and contract surfaces rather than duplicating storage logic in the CLI.
3. Document which commands are read-only and which are future control hooks.
4. Add smoke tests for core operator commands.

### Acceptance criteria
1. The CLI can inspect runs, packets, step results, and delivery evidence beyond the bootstrap commands.
2. Live follow mode reuses the shared event stream rather than inventing a second protocol.
3. Read-only versus future control semantics are explicit in help output and docs.
4. Smoke tests cover the core operator command paths.

### Done evidence
- operator CLI transcript
- help output fixtures
- updated CLI command catalog

### Out of scope
- web UI rendering
- actual write-side operator controls

---

## W5-S04 — Detachable web UI baseline
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Prove the headless-first but UI-attachable model by adding a detachable web operator console.
- **Primary modules:** `apps/web`, `apps/api`, `docs/ops/**`
- **Hard dependencies:** W5-S01, W5-S02
- **Primary user-story surfaces:** operator / SRE, AI platform owner, web surface developer

### Local tasks
1. Implement a minimal web console for run lists, run detail, artifact links, and live event follow.
2. Keep the UI optional and detachable from the runtime.
3. Reuse the API contracts and event stream directly.
4. Document the attach and detach flow and local dev path.

### Acceptance criteria
1. A minimal web console can list runs, inspect run detail, and follow live events.
2. The web UI remains optional and detachable; headless CLI flows continue to work without it.
3. The UI consumes the same API contracts and event stream exposed to other clients.
4. The attach/detach workflow is documented for local development and operations.

### Done evidence
- web UI smoke path
- attach/detach runbook update
- API/UI contract alignment notes

### Out of scope
- operator write controls
- auth or multi-tenant production hardening

---

## W5-S05 — Standard live E2E orchestration runner
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Run the selected public-target scenarios through the actual control plane instead of bespoke one-off scripts.
- **Primary modules:** `apps/cli`, `apps/api`, `docs/ops/**`, `examples/live-e2e/**`
- **Hard dependencies:** W5-S03, W4-S06, W3-S06
- **Primary user-story surfaces:** operator / SRE, AI platform owner, engineering manager / planner

### Local tasks
1. Create one orchestration entrypoint for the standard live E2E scenarios in the target catalog.
2. Reuse the same packet, route, quality, and delivery infrastructure used by product features.
3. Emit durable run summaries and per-target scorecards.
4. Document how to start, observe, and abort a standard live E2E run.

### Acceptance criteria
1. Selected live E2E scenarios execute through the same control plane used by product features.
2. Run output includes durable summaries and per-target scorecards.
3. Operators can start, observe, and abort standard live E2E runs through documented surfaces.
4. Per-target behavior remains aligned with the target catalog and runbooks.

### Done evidence
- standard live E2E transcripts
- scorecard fixtures
- updated runbook index

### Out of scope
- incident capture and learning-loop materialization
- production rollout automation

---

## W5-S06 — Scorecards, incident capture, and learning-loop handoff
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Close the loop from live E2E and delivery output back into roadmap, eval, and asset improvement work.
- **Primary modules:** `packages/observability`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/backlog/**`
- **Hard dependencies:** W5-S05, W3-S05
- **Primary user-story surfaces:** engineering manager / planner, AI platform owner, finance / audit

### Local tasks
1. Materialize durable scorecards and incident reports from live E2E and delivery runs.
2. Link incidents and regressions back to eval suites, harness captures, or backlog slices when possible.
3. Expose a handoff path from live operations back into roadmap planning.
4. Document the learning-loop workflow so it is repeatable rather than tribal knowledge.

### Acceptance criteria
1. Live E2E and delivery runs can emit durable scorecards and incident reports.
2. Incident artifacts link back to the relevant runs, evidence roots, and improvement surfaces when possible.
3. There is a documented handoff from live operations back into backlog and quality work.
4. Learning-loop behavior is repeatable and inspectable rather than tribal knowledge.

### Done evidence
- incident-report fixtures
- scorecard examples
- updated backlog and ops docs

### Out of scope
- automated backlog reprioritization
- multi-tenant productization or billing flows

---
