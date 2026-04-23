# W9 implementation slices

## Wave objective
Stabilize post-audit backlog findings by fixing routed-evidence durability and source-of-truth drift first, then reopening public quality surfaces, transport decoupling, and live adapter execution on explicit bounded foundations.

## Wave exit criteria
- routed step results and compiled-context artifacts are durable per run and no longer overwrite prior evidence
- repo-entry and control-plane docs clearly distinguish current implementation from target architecture
- control-plane API contract coverage is machine-checkable rather than narrative-only
- public CLI quality surfaces include harness replay plus asset promote/freeze flows with durable evidence
- connected web mode can use a detached HTTP/SSE control-plane transport without breaking headless operation
- a first supported non-mock adapter can execute live routed work under explicit policy guardrails

## Parallel start and sequencing notes
- `W9-S01`, `W9-S02`, `W9-S03`, `W9-S05`, and `W9-S06` can start in parallel after W8 closes because all hard dependencies are already satisfied.
- `W9-S02` should land early so repo-entry documentation stops misreporting current backlog and command-surface status.
- `W9-S04` starts after `W9-S03` so machine-checkable API contracts reflect the corrected current-state boundary.
- `W9-S07` starts after `W9-S03` and `W9-S04` so the detached transport baseline consumes aligned docs and contract shapes.
- `W9-S08` starts after `W9-S01` so live execution builds on non-overwriting routed evidence outputs.

---

## W9-S01 — Run-scoped routed evidence durability bugfix
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Prevent repeated routed executions in one runtime root from overwriting prior `step-result` and `compiled-context` evidence.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W8-S08
- **Primary user-story surfaces:** delivery engineer, reviewer / QA

### Local tasks
1. Replace step-class-static routed artifact naming with run/step-scoped deterministic identifiers.
2. Keep routed evidence refs linked correctly from `step-result` outputs and operator-facing surfaces.
3. Update execution and evidence docs to define run-scoped routed artifact semantics.
4. Add regression tests for repeated same-step executions sharing one runtime root.

### Acceptance criteria
1. Repeated same-step routed executions in one runtime root keep distinct `step-result` and `compiled-context` artifacts.
2. `step-result` evidence refs resolve to the correct per-run compiled-context artifact.
3. CLI and operator evidence reads still load routed artifacts without ambiguity after the naming change.
4. Tests and docs cover the overwrite regression explicitly.

### Done evidence
- orchestrator-core regression tests for repeated routed executions
- sample runtime artifact bundle showing two same-step runs with distinct refs
- updated execution/evidence docs for run-scoped routed artifacts

### Out of scope
- detached HTTP transport
- first real provider adapter execution

---

## W9-S02 — Current-state documentation drift repair
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Repair repo-entry docs so backlog counts, command counts, repo map, and current-versus-target wording match the actual repository state.
- **Primary modules:** `README.md`, `docs/architecture/00-repo-layout.md`, `docs/architecture/03-technical-stack.md`, `docs/backlog/**`
- **Hard dependencies:** none
- **Primary user-story surfaces:** project bootstrap / onboarding, architect / tech lead, product sponsor / owner

### Local tasks
1. Update repo-entry counts and implementation status statements to match the current backlog and command catalog.
2. Split current scaffold facts from target-architecture stack statements where the docs currently blur the boundary.
3. Correct repo-map language that still marks implemented apps/packages as planned.
4. Add or extend consistency checks where repo-entry drift can be validated automatically.

### Acceptance criteria
1. `README.md` reflects the actual backlog queue state and the current implemented/planned command-surface counts from `apps/cli/src/command-catalog.mjs`.
2. Architecture overview docs no longer describe implemented apps/packages as merely planned.
3. Technical-stack language clearly distinguishes target design from current runtime/scaffold reality.
4. Updated docs stay consistent with the backlog, command catalog, and root checks.

### Done evidence
- updated repo-entry docs with current-state counts
- consistency checks or tests covering the corrected status statements
- audit note or fixture proving current-versus-target wording is aligned

### Out of scope
- implementing missing target-stack components
- adding new runtime features

---

## W9-S03 — Control-plane API contract/runtime alignment
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Align control-plane API docs with the current in-process module surface and make future detached HTTP transport explicit rather than implied.
- **Primary modules:** `docs/contracts/control-plane-api.md`, `apps/api`, `apps/web`, `docs/architecture/**`
- **Hard dependencies:** W8-S04
- **Primary user-story surfaces:** operator / SRE, delivery engineer, architect / tech lead

### Local tasks
1. Document the current control-plane surface as module-backed/in-process where that is the implemented reality.
2. Update web/operator docs so connected mode language matches current direct-module consumption.
3. Separate future detached transport expectations into explicit deferred semantics tied to the transport slice.
4. Align smoke tests or fixtures with the corrected control-plane/API wording.

### Acceptance criteria
1. Docs no longer imply HTTP endpoints exist today unless code provides them.
2. The current module API and in-process web integration model are described explicitly and consistently.
3. Future detached transport work is still visible, but clearly deferred to the dedicated transport slice.
4. API/web/docs terminology is internally consistent after the change.

### Done evidence
- updated control-plane API and operator-surface docs
- refreshed API/web smoke fixtures or transcripts aligned with the corrected wording
- explicit deferred-transport references linked to `W9-S07`

### Out of scope
- implementing an HTTP server
- adding new auth or permission layers

---

## W9-S04 — Machine-checkable control-plane API contract coverage
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Replace the narrative-only control-plane API limitation with loader-covered operation/response contract shapes.
- **Primary modules:** `docs/contracts/control-plane-api.md`, `packages/contracts`, `examples/**`, `apps/api`
- **Hard dependencies:** W9-S03
- **Primary user-story surfaces:** architect / tech lead, operator / SRE

### Local tasks
1. Define machine-loadable control-plane API contract shapes for the currently supported surface.
2. Extend contract loader coverage and integrity checks to validate the new family.
3. Add contract-valid examples or fixtures for supported API operations/responses.
4. Add tests for loader mapping, validation failure shapes, and docs/index alignment.

### Acceptance criteria
1. `control-plane-api` is no longer marked as a narrative-only limitation in contract coverage.
2. The shared contract loader validates the supported control-plane API shapes.
3. Examples or fixtures exist for the machine-checkable API surface.
4. Tests cover valid and invalid API contract documents plus index/coverage alignment.

### Done evidence
- contract loader coverage updated to `implemented` for control-plane API
- example or fixture set for supported API shapes
- automated tests for validation and coverage mapping

### Out of scope
- detached HTTP transport implementation
- modeling every future command surface in one pass

---

## W9-S05 — Public harness replay command surface
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Expose existing harness replay core capability through `aor harness replay` with durable outputs, help text, docs, and tests.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `docs/architecture/**`, `docs/ops/**`
- **Hard dependencies:** W3-S04, W8-S05
- **Primary user-story surfaces:** reviewer / QA, AI platform owner, operator / SRE

### Local tasks
1. Add `aor harness replay` to the CLI catalog and wire it to the existing harness replay runtime.
2. Surface required inputs, durable outputs, and incompatibility failure semantics in help/output paths.
3. Update quality runbooks and command catalog docs for replay workflows.
4. Add CLI and runtime tests for successful replay and incompatible capture handling.

### Acceptance criteria
1. `aor harness replay` is removed from the planned-command list and works against existing harness captures.
2. Help text and docs describe replay inputs, durable outputs, and incompatibility behavior.
3. CLI tests cover success and explicit incompatibility failure paths.
4. Replay artifacts remain durable and queryable through existing evidence surfaces.

### Done evidence
- CLI transcript fixture for `aor harness replay`
- harness replay report fixture linked from a CLI test
- updated quality runbook and command catalog docs

### Out of scope
- asset promote/freeze command work
- first real provider adapter execution

---

## W9-S06 — Asset promote/freeze command surface completion
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Implement public `aor asset promote` and `aor asset freeze` command surfaces backed by existing promotion/freeze evidence and governance rules.
- **Primary modules:** `apps/cli`, `packages/orchestrator-core`, `docs/contracts/**`, `docs/ops/**`, `examples/eval/**`
- **Hard dependencies:** W7-S02, W8-S09
- **Primary user-story surfaces:** AI platform owner, finance / audit / hygiene, incident / improvement owner

### Local tasks
1. Add CLI definitions and handlers for asset promote/freeze workflows.
2. Reuse promotion/freeze evidence requirements and guardrails from the existing certification decision path.
3. Update command docs, help output, and ops guidance for promote/freeze usage.
4. Add tests for promote, hold, fail, and freeze edge cases.

### Acceptance criteria
1. `aor asset promote` and `aor asset freeze` are removed from the planned-command list.
2. Both commands enforce promotion/freeze evidence requirements and keep auditability explicit.
3. Help/docs semantics match runtime decision behavior, including hold/fail/freeze outcomes.
4. Tests cover promote, hold, fail, and freeze paths.

### Done evidence
- CLI transcript fixtures for asset promote and asset freeze
- promotion/freeze decision fixtures linked to command outputs
- automated tests for guardrail and edge-case behavior

### Out of scope
- new scoring or certification heuristics
- incident recertification redesign

---

## W9-S07 — Detached HTTP control-plane transport baseline
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Add a real HTTP/SSE transport baseline for supported control-plane reads/follow paths and make connected web mode consume it instead of direct module imports.
- **Primary modules:** `apps/api`, `apps/web`, `docs/contracts/**`, `docs/architecture/**`
- **Hard dependencies:** W9-S03, W9-S04
- **Primary user-story surfaces:** operator / SRE, delivery engineer

### Local tasks
1. Add a minimal HTTP transport wrapper for the currently supported read and live-follow surfaces.
2. Implement an SSE stream for the supported live-run event path.
3. Switch connected web mode to use the detached transport while preserving headless-safe operation.
4. Add transport smoke tests and update control-plane transport docs.

### Acceptance criteria
1. The supported connected-mode API/web boundary is transport-backed rather than direct-module-only.
2. HTTP read endpoints and SSE follow support exist for the documented baseline surface implemented in this slice.
3. Headless and in-process workflows remain supported where they are still required.
4. Docs and smoke tests cover transport-backed connected mode explicitly.

### Done evidence
- API transport smoke tests for read and SSE follow paths
- connected-mode web transcript or fixture using the detached transport
- updated control-plane transport docs

### Out of scope
- full mutation-command HTTP surface
- production authz hardening

---

## W9-S08 — First real provider adapter and live execution foundation
- **Epic:** EPIC-3 Routed execution
- **State:** ready
- **Outcome:** Add a first supported non-mock provider adapter baseline and unblock live routed execution for approved configurations.
- **Primary modules:** `packages/adapter-sdk`, `packages/orchestrator-core`, `apps/cli`, `docs/contracts/**`, `examples/adapters/**`
- **Hard dependencies:** W9-S01, W8-S03, W8-S08
- **Primary user-story surfaces:** delivery engineer, AI platform owner, security / compliance

### Local tasks
1. Define the first real provider adapter profile and capability negotiation path.
2. Extend routed execution to select live adapter execution when policy and configuration permit it.
3. Preserve dry-run/mock behavior and policy-blocked semantics for unsupported or risky routes.
4. Update adapter/execution docs and add tests for live-success and blocked paths.

### Acceptance criteria
1. Live adapter execution no longer always fails with "live adapter execution is not implemented yet" when a supported adapter is selected.
2. Unsupported or unapproved routes still block deterministically with explicit guardrail output.
3. Live adapter requests preserve compiled-context and evidence lineage semantics.
4. Tests and docs cover mock, live-success, and policy-blocked execution paths.

### Done evidence
- first real adapter profile example and execution fixture
- orchestrator-core and CLI tests for live execution and blocked guardrail paths
- updated adapter/execution docs for the live baseline

### Out of scope
- multi-provider rollout in one slice
- autonomous upstream delivery automation
