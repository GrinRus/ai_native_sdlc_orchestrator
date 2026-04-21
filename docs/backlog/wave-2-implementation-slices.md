# W2 implementation slices

## Wave objective
Introduce the first real routed execution path across routes, wrappers, prompt bundles, policies, and adapters.

## Wave exit criteria
- route resolution works for at least discovery, research, plan, implement, review, and QA step shapes
- wrappers, prompt bundles, and step policies resolve through one runtime stack
- the adapter SDK supports capability negotiation and a mock adapter for deterministic rehearsal
- routed execution writes durable step results with asset, budget, and adapter metadata
- a no-write routed rehearsal runs against approved packets without delivery-side write-back

## Parallel start and sequencing notes
- `W2-S02`, `W2-S03`, and `W2-S04` can move in parallel once route resolution exists.
- `W2-S05` is the join point for assets, policies, adapter capability, and runtime state.
- `W2-S06` should stay no-write and evidence-heavy before any delivery automation is enabled.

---

## W2-S01 — Route registry and step resolution kernel
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Resolve every step type through an explicit route model instead of hard-coded command branches.
- **Primary modules:** `packages/provider-routing`, `packages/orchestrator-core`, `docs/contracts/**`, `examples/routes/**`
- **Hard dependencies:** W1-S08
- **Primary user-story surfaces:** AI platform owner, architect / tech lead, operator / SRE

### Local tasks
1. Implement a route registry that maps step classes to route profiles and provider-selection hints.
2. Support project-level defaults and step-level overrides without hidden magic.
3. Normalize route resolution output so later wrapper, prompt, and policy loaders can consume it directly.
4. Document how route selection works and how new step classes should be added.

### Acceptance criteria
1. Discovery, research, plan, implement, review, QA, repair, eval, and harness step classes resolve through explicit route profiles.
2. Project defaults and step-level overrides are applied deterministically and are visible in run output.
3. Route-resolution failures identify the missing or conflicting route source cleanly.
4. Route resolution is reusable by CLI, API, and later live E2E orchestration paths.

### Done evidence
- route-resolution tests
- validated example routes
- updated architecture and contract docs

### Out of scope
- actual model execution
- adapter capability negotiation

---

## W2-S02 — Wrapper, prompt-bundle, and asset loader runtime
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Load wrappers and prompt bundles as first-class runtime assets instead of embedding prompts directly in code paths.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `examples/wrappers/**`, `examples/prompts/**`
- **Hard dependencies:** W2-S01
- **Primary user-story surfaces:** AI platform owner, prompt engineer, architect / tech lead

### Local tasks
1. Load wrapper profiles and prompt bundles through the shared contract path.
2. Compose the resolved route with wrapper and prompt-bundle data into one runtime asset bundle.
3. Capture asset provenance in step metadata so runs can be replayed and compared later.
4. Document asset-loading order and override rules.

### Acceptance criteria
1. Wrapper profiles and prompt bundles load through one shared runtime path.
2. The execution runtime can materialize a resolved asset bundle that names the route, wrapper, and prompt bundle used for a step.
3. Asset-resolution output includes provenance metadata suitable for replay and certification later.
4. Asset-loading order and override rules are documented and testable.

### Done evidence
- asset-loader tests
- resolved asset-bundle fixtures
- updated platform-asset lifecycle docs

### Out of scope
- budget or retry policy enforcement
- provider-specific prompt shims inside orchestrator core

---

## W2-S03 — Step policy resolution, budgets, and guardrails
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Make execution bounds explicit by resolving step policies before any adapter call happens.
- **Primary modules:** `packages/orchestrator-core`, `docs/contracts/**`, `examples/policies/**`
- **Hard dependencies:** W2-S01
- **Primary user-story surfaces:** security / compliance, operator / SRE, AI platform owner

### Local tasks
1. Resolve step policies for budgets, retries, command allowances, write-back mode, and timeout boundaries.
2. Merge project defaults, route defaults, and explicit step overrides deterministically.
3. Expose resolved policy metadata in step planning output before execution starts.
4. Document the non-negotiable guardrails that every runner execution must honor.

### Acceptance criteria
1. Step policies resolve through one deterministic merge path with explicit precedence rules.
2. Budgets, retries, timeouts, command constraints, and write-back mode are visible before execution starts.
3. A missing or conflicting required policy causes a deterministic failure before adapter invocation.
4. Resolved policy data is persisted into step metadata for later replay and audit.

### Done evidence
- policy-resolution tests
- resolved policy fixtures
- updated safety and execution docs

### Out of scope
- adapter capability negotiation
- actual command execution inside runners

---

## W2-S04 — Adapter SDK and mock adapter baseline
- **Epic:** EPIC-3 Routed execution
- **State:** done
- **Outcome:** Create a runner-agnostic adapter surface that can start with deterministic mocks before real providers are wired in.
- **Primary modules:** `packages/adapter-sdk`, `packages/orchestrator-core`, `examples/adapters/**`
- **Hard dependencies:** W2-S01
- **Primary user-story surfaces:** AI platform owner, adapter author, operator / SRE

### Local tasks
1. Define adapter capabilities, request and response envelopes, and step lifecycle hooks.
2. Implement a mock adapter that returns deterministic step outputs and evidence.
3. Expose capability negotiation so routes can reject unsupported adapter selections early.
4. Document how new runner adapters should be added without leaking provider details into core.

### Acceptance criteria
1. The adapter SDK defines a stable request/response surface and capability metadata.
2. A mock adapter can execute deterministic dry-run steps for tests and rehearsals.
3. Route or asset resolution fails early when a selected adapter lacks a required capability.
4. Provider-specific behavior stays behind the adapter boundary rather than inside orchestrator core.

### Done evidence
- adapter-sdk tests
- mock-adapter fixtures
- adapter author guidance

### Out of scope
- production provider integrations
- quality certification of real models

---

## W2-S05 — Routed step execution engine and durable step results
- **Epic:** EPIC-3 Routed execution
- **State:** ready
- **Outcome:** Execute routed steps end to end in bounded mode and persist normalized step results with asset and policy provenance.
- **Primary modules:** `packages/orchestrator-core`, `packages/observability`, `apps/cli`, `packages/adapter-sdk`
- **Hard dependencies:** W2-S02, W2-S03, W2-S04, W1-S06
- **Primary user-story surfaces:** delivery engineer, reviewer / QA, operator / SRE

### Local tasks
1. Join route resolution, asset loading, policy resolution, and adapter invocation into one execution path.
2. Persist a normalized step-result artifact for every step, including no-op and failed steps.
3. Record timestamps, selected assets, budgets, adapter metadata, and evidence roots.
4. Provide a dry-run mode that proves orchestration without any delivery-side write-back.

### Acceptance criteria
1. A single execution engine resolves route, assets, policy, and adapter before invoking a step.
2. Every step writes a normalized step-result artifact that is reloadable after process restart.
3. Selected assets, policy bounds, adapter metadata, and evidence roots are persisted in step results.
4. The engine supports a dry-run mode that stays within bounded no-write safety rules.

### Done evidence
- step-result fixtures
- execution-engine tests
- CLI smoke path for routed dry-run execution

### Out of scope
- delivery write-back modes
- web UI or API control-plane surfaces

---

## W2-S06 — First routed execution rehearsal
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Prove that approved packets can drive no-write routed steps before delivery automation begins.
- **Primary modules:** `apps/cli`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`
- **Hard dependencies:** W2-S05, W1-S07, W0-S05
- **Primary user-story surfaces:** operator / SRE, AI platform owner, engineering manager / planner

### Local tasks
1. Run a no-write rehearsal that consumes an approved handoff packet and executes a bounded routed step sequence.
2. Use the mock adapter first so the orchestration path is proven independently from provider variability.
3. Capture step-result evidence and operator-readable transcripts.
4. Update the relevant runbooks with the routed rehearsal procedure and abort rules.

### Acceptance criteria
1. A documented routed rehearsal consumes approved packets and produces durable step results without write-back.
2. The rehearsal runs through the same route, asset, policy, and adapter stack used by product execution.
3. Evidence remains inspectable after partial or failed runs.
4. Runbooks describe exact start, stop, and abort behavior for the rehearsal.

### Done evidence
- routed rehearsal transcript
- step-result evidence set
- updated live E2E runbook

### Out of scope
- real provider benchmarking
- delivery or release writes

---
