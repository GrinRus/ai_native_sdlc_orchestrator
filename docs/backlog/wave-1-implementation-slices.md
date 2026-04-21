# W1 implementation slices

## Wave objective
Make project bootstrap and early packet materialization work end to end in headless mode.

## Wave exit criteria
- `aor project init`, `analyze`, `validate`, and `verify` have working smoke paths
- runtime state materializes under `.aor/` with durable project-scoped artifact directories
- project-analysis, validation, and step-result artifacts are contract-compliant and reloadable
- artifact, wave, and handoff packet skeletons can be created and validated
- a no-write bootstrap rehearsal works on the AOR repo and one selected public target

## Parallel start and sequencing notes
- `W1-S03`, `W1-S04`, and `W1-S06` can branch after `W1-S02` lands.
- `W1-S05` should reuse the safety policy and bounded execution rules from Wave 0 live E2E preflight.
- `W1-S08` is the closeout rehearsal and should not start until the bootstrap evidence chain is durable.

---

## W1-S01 — Bootstrap CLI shell and command contracts
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Define the first stable command surface for bootstrap work without yet implementing the full control plane.
- **Primary modules:** `apps/cli`, `docs/architecture/14-cli-command-catalog.md`, `docs/contracts/**`
- **Hard dependencies:** W0-S01, W0-S02
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, AI platform owner

### Local tasks
1. Define the CLI entrypoints and command help for `project init`, `analyze`, `validate`, and `verify`.
2. Connect the command surface to the contract loader and runtime-root conventions.
3. Document the difference between implemented commands and future planned commands.
4. Add smoke tests for argument parsing and help output.

### Acceptance criteria
1. The CLI exposes named bootstrap commands with documented inputs and outputs.
2. Command metadata aligns with the documented command catalog and contract families.
3. Unknown commands, missing required flags, and invalid project refs fail clearly.
4. Help output is explicit about which flows are already implemented versus planned.

### Done evidence
- CLI help transcript or fixture
- argument parsing tests
- updated CLI command catalog

### Out of scope
- route, wrapper, or adapter execution
- web or API operator surfaces

---

## W1-S02 — Project init and profile loading runtime
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Create the first real project-aware runtime path from a repo root to durable AOR state.
- **Primary modules:** `apps/cli`, `packages/contracts`, `packages/orchestrator-core`
- **Hard dependencies:** W1-S01
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, AI platform owner

### Local tasks
1. Implement project discovery from the working directory or explicit repo path.
2. Load the selected project profile and resolve the runtime root under `.aor/`.
3. Create the project-scoped directory layout idempotently.
4. Keep example project profiles and real runtime loading on the same code path.

### Acceptance criteria
1. `aor project init` can discover a repo root, load a project profile, and create `.aor/` predictably.
2. The runtime layout is idempotent across repeated runs against the same repo.
3. Project identity and selected profile refs are recorded in durable runtime state.
4. Example project profiles still load through the same code path used in the runtime.

### Done evidence
- project-init fixture output
- profile loader tests
- runtime-root layout documentation

### Out of scope
- deep repo analysis
- delivery-manifest or release-packet generation

---

## W1-S03 — Project analysis engine and durable analysis report
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Materialize repeatable knowledge about a target repository instead of relying on ad hoc interpretation.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `apps/cli`
- **Hard dependencies:** W1-S02
- **Primary user-story surfaces:** project bootstrap / onboarding, discovery / research, architect / tech lead

### Local tasks
1. Inspect repo topology, package manager or toolchain, available commands, and obvious service boundaries.
2. Write the result as a contract-compliant project-analysis report under `.aor/`.
3. Record unknown or low-confidence facts explicitly rather than guessing.
4. Make the report reusable by validate, verify, and later live E2E flows.

### Acceptance criteria
1. `aor project analyze` records repo topology, toolchain signals, and runnable command candidates.
2. The output is a durable project-analysis report that can be reloaded after process restart.
3. Low-confidence facts are marked as unknown, guessed facts are not silently promoted to truth.
4. The analysis flow works against the AOR repo and at least one other fixture or selected public clone.

### Done evidence
- generated analysis-report fixtures
- analysis tests for at least two repo shapes
- updated bootstrap docs or examples

### Out of scope
- issue ingestion
- handoff packet generation from natural-language discovery

---

## W1-S04 — Deterministic project validate flow
- **Epic:** EPIC-4 Quality platform
- **State:** done
- **Outcome:** Create the first objective gate in the system before judge-based evals or runner execution exist.
- **Primary modules:** `packages/contracts`, `packages/orchestrator-core`, `apps/cli`
- **Hard dependencies:** W1-S02, W0-S03
- **Primary user-story surfaces:** reviewer / QA, security / compliance, project bootstrap / onboarding

### Local tasks
1. Validate project-profile integrity, required defaults, referenced assets, and write-back safety defaults.
2. Optionally consume the project-analysis report when it exists without depending on speculative runtime behavior.
3. Emit a contract-compliant validation report with pass, warn, and fail semantics.
4. Block later bootstrap commands when policy requires validation to pass first.

### Acceptance criteria
1. `aor project validate` checks project profile structure, required defaults, asset refs, and safety policies.
2. Validation produces a durable validation report with explicit pass, warn, and fail states.
3. Later bootstrap flows can refuse to proceed when required validation checks fail.
4. Tests cover both a passing project profile and at least one meaningful failing case.

### Done evidence
- validation-report fixtures
- negative test cases
- updated bootstrap runbook text

### Out of scope
- LLM-judge style evaluation
- harness replay and certification

---

## W1-S05 — Project verify flow and bounded preflight execution
- **Epic:** EPIC-1 Bootstrap and onboarding
- **State:** done
- **Outcome:** Prove that a target project is runnable under bounded local rules before orchestration attempts delivery work.
- **Primary modules:** `packages/orchestrator-core`, `apps/cli`, `packages/observability`
- **Hard dependencies:** W1-S03, W1-S04, W0-S05
- **Primary user-story surfaces:** project bootstrap / onboarding, operator / SRE, security / compliance

### Local tasks
1. Run only allowed verification commands inside bounded repo scope and record the result of each command.
2. Respect workspace isolation, network defaults, and write-back safety policy.
3. Normalize command outcomes into step results that later flows can reuse.
4. Expose enough detail to unblock a human or agent when verification fails.

### Acceptance criteria
1. `aor project verify` runs bounded verification commands and records each result durably.
2. Verify respects no-write defaults and other preflight safety policies from the live E2E catalog.
3. Failures identify missing prerequisites, command ownership, and the blocked next step.
4. Verify output is reusable by bootstrap rehearsals and later quality or delivery rehearsals.

### Done evidence
- verify command transcript or fixture
- normalized step-result examples
- bounded-execution tests or stubs

### Out of scope
- implementation, review, QA, or repair execution steps
- direct writes to upstream repositories

---

## W1-S06 — Runtime store and artifact packet materialization
- **Epic:** EPIC-2 Packet lifecycle
- **State:** done
- **Outcome:** Give bootstrap flows a durable artifact path so later SDLC stages inherit a consistent packet model.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `apps/cli`
- **Hard dependencies:** W1-S02
- **Primary user-story surfaces:** engineering manager / planner, discovery / research, delivery engineer

### Local tasks
1. Design the project-scoped runtime store layout under `.aor/` with stable IDs and predictable directories.
2. Materialize the first artifact packet shape from bootstrap inputs or approved source material.
3. Link packet metadata back to project identity, invocation context, and evidence roots.
4. Allow packets to be reloaded after process restart without special recovery logic.

### Acceptance criteria
1. The runtime store organizes project-scoped artifacts under `.aor/` with stable IDs and predictable paths.
2. The system can create at least the first artifact-packet shape from bootstrap inputs.
3. Packet metadata links back to project identity, command invocation, and evidence roots.
4. Packets can be reloaded and inspected after process restart without custom migration logic.

### Done evidence
- runtime-store examples under fixtures
- packet materialization tests
- updated architecture docs if layout changed

### Out of scope
- route, wrapper, prompt-bundle, or adapter execution
- delivery manifests and release packets

---

## W1-S07 — Wave ticket and handoff packet foundation
- **Epic:** EPIC-2 Packet lifecycle
- **State:** done
- **Outcome:** Establish the durable approval boundary that later execution work will consume.
- **Primary modules:** `packages/orchestrator-core`, `packages/contracts`, `examples/packets/**`
- **Hard dependencies:** W1-S04, W1-S06
- **Primary user-story surfaces:** engineering manager / planner, reviewer / QA, delivery engineer

### Local tasks
1. Materialize a wave ticket and a handoff packet from approved bootstrap artifacts or explicit input fixtures.
2. Capture scope, constraints, allowed commands, and write-back mode explicitly in handoff packets.
3. Make approval state explicit and machine-checkable.
4. Block downstream execution-shaped flows when the handoff packet is missing or unapproved.

### Acceptance criteria
1. The system can create wave-ticket and handoff-packet artifacts from approved input.
2. Handoff packets capture scope, constraints, command policy, and write-back mode explicitly.
3. Approval state is explicit and machine-checkable.
4. Validation blocks downstream execution-style flows when required approval artifacts are absent or unapproved.

### Done evidence
- generated packet fixtures
- approval validation checks
- updated packet docs and examples

### Out of scope
- actual implement, review, or QA runner execution
- PR creation or write-back

---

## W1-S08 — Bootstrap end-to-end rehearsal
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** ready
- **Outcome:** Prove that the Wave 1 baseline closes as one bounded flow on real inputs before moving on to routed execution.
- **Primary modules:** `apps/cli`, `docs/ops/**`, `examples/live-e2e/**`, `packages/observability`
- **Hard dependencies:** W1-S03, W1-S04, W1-S05, W1-S07
- **Primary user-story surfaces:** operator / SRE, AI platform owner, project bootstrap / onboarding

### Local tasks
1. Run a documented no-write rehearsal that executes `project init`, `analyze`, `validate`, and `verify` and materializes the first packet artifacts.
2. Run the rehearsal on the AOR repo and at least one selected public target.
3. Preserve durable evidence under `.aor/` for success and safe failure paths.
4. Update the relevant live E2E runbook with the exact bootstrap rehearsal procedure.

### Acceptance criteria
1. A documented no-write rehearsal runs the bootstrap flow and materializes the first packet artifacts.
2. The rehearsal works on the AOR repo and at least one selected public target from the live E2E catalog.
3. Durable analysis, validation, verify, and packet evidence remain inspectable under `.aor/` after the run.
4. Failure paths remain safe: no upstream writes and no hidden partial state.

### Done evidence
- rehearsal transcript or fixture capture
- durable `.aor/` example tree or sample output
- updated runbook and profile docs

### Out of scope
- release packet generation
- route, wrapper, prompt-bundle, or adapter execution

---
