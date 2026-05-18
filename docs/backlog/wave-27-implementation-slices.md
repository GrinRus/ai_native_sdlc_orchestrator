# W27 implementation slices

## Wave objective
Replace legacy live E2E post-run matrices with an online black-box step-controller journal and resumable interactive continuation, then remove the unsupported legacy report path in the same delivery slice.

## Wave exit criteria
- Live E2E observation reports validate only the ordered step-journal contract.
- Runtime interaction answers resume supported checkpoints and fail closed for unsupported boundaries.
- Profiles, skills, runbooks, fixtures, and tests no longer depend on legacy matrix fields or delivery downgrade behavior.

## Sequencing notes
- `W27-S01` defines the breaking contract before runtime and runner output depend on it.
- `W27-S02` follows the contract so control-plane answers can write durable resume evidence.
- `W27-S03` follows contract and runtime resume so the proof runner can plan, execute, inspect, classify, decide, and persist each public step online.
- `W27-S04` follows runner output so profiles and skills describe the supported operator procedure.
- `W27-S05` closes the wave by removing old fixtures, docs, snapshots, and status expectations.

---

## W27-S01 — Step-journal observation contract
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Define the ordered live E2E step journal as the only supported observation report format.
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`, `examples/reports/**`
- **Hard dependencies:** W26-S03
- **Primary user-story surfaces:** operator proof, release rehearsal, and live E2E audit surfaces

### Local tasks
1. Replace the legacy observation contract with `step_journal`, `final_analysis`, interaction decisions, frontend interactions, and evidence refs.
2. Reject legacy report fields such as `step_matrix`, `artifact_quality_matrix`, `code_quality_after_delivery`, and synthetic continuation decisions.
3. Update contract loader tests and sample reports to the breaking format.

### Acceptance criteria
1. New live E2E reports validate only in step-journal format.
2. Legacy matrix-shaped reports fail contract validation.
3. Contract docs state that delivery evidence no longer downgrades terminal failures.

### Done evidence
- updated contract family and loader validation
- step-journal report sample
- contract tests for accepted and rejected shapes

### Out of scope
- compatibility adapters
- dual-write report generation

---

## W27-S02 — Runtime interaction resume
- **Epic:** EPIC-6 Operator control plane
- **State:** done
- **Outcome:** Make `run answer` and the HTTP answer route resume supported runtime checkpoints instead of only accepting a blocked answer.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `apps/web/**`, tests
- **Hard dependencies:** W27-S01
- **Primary user-story surfaces:** operator intervention, API control plane, and web console surfaces

### Local tasks
1. Persist answer audit evidence before runtime resume.
2. Resume checkpoints whose continuation action supports `resume_from_boundary`.
3. Emit deterministic `resumed`, `resume_failed`, or `blocked` state transitions with query-safe evidence refs.
4. Remove the old “answer accepted, runtime boundary unavailable” behavior.

### Acceptance criteria
1. CLI and HTTP answer paths return resumed state for resumable checkpoints.
2. Unsupported checkpoints fail closed with evidence.
3. Raw answers do not appear in query-safe events.

### Done evidence
- control-plane answer tests
- CLI/API/web projection updates
- step-result contract documentation for resumed interactions

### Out of scope
- provider-specific runtime internals in the control-plane route
- raw-answer event payloads

---

## W27-S03 — Live E2E online step controller output
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Emit black-box step observations and a report-level ordered journal from public CLI/API/web evidence while controller decisions gate continuation.
- **Primary modules:** `scripts/live-e2e/**`, `scripts/test/**`
- **Hard dependencies:** W27-S01, W27-S02
- **Primary user-story surfaces:** live E2E proof runner and target-catalog execution surfaces

### Local tasks
1. Build one journal entry per observed public step with a required `plan`.
2. Persist step observation artifacts and controller state after each included step, before the next public step.
3. Represent deterministic analysis, semantic analysis, interaction requests, decisions, resume results, and frontend interaction refs per step.
4. Enforce profile-controlled delivery-default versus full-lifecycle flow ranges.
5. Add shared controller entrypoints for automatic `run-profile`, `manual-live-e2e`, and fail-closed `harness-evaluator` workflows.

### Acceptance criteria
1. Delivery-default profiles observe through delivery.
2. Guided and full-lifecycle profiles include release and learning as ordinary observed steps.
3. Step observation files and `live_e2e_controller_state_file` are linked from run summaries and reports.
4. Manual workflow executes one pending step per invocation and resumes by `run-id`.
5. Harness evaluator fails closed when plan/execution/inspection/classification/decision/persist evidence is missing.
6. Runner output no longer emits legacy matrix fields.

### Done evidence
- runner implementation updates
- live E2E proof-runner tests
- generated report validation through contracts

### Out of scope
- importing runtime internals into the proof runner
- maintaining post-run-only observation as a parallel mode

---

## W27-S04 — Profile and skill migration
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Move live E2E profiles, skills, and runbooks to the black-box execute-inspect-decide-interact-resume procedure.
- **Primary modules:** `.agents/skills/**`, `scripts/live-e2e/profiles/**`, `docs/ops/**`
- **Hard dependencies:** W27-S03
- **Primary user-story surfaces:** operator rehearsal, preflight, and guided proof surfaces

### Local tasks
1. Require each live E2E profile to declare flow range, interaction capability, frontend capability, and safety policy.
2. Rewrite `live-e2e-runner` around the step loop: plan, execute, inspect, classify, decide, interact, resume, report.
3. Rewrite `live-e2e-preflight` checks for the new profile policy.
4. Update live E2E runbooks to remove post-run-only runner instructions.

### Acceptance criteria
1. Profile catalog loading rejects profiles without live E2E policy metadata.
2. Skills describe step-journal reporting and no legacy verdict matrix.
3. Runbooks describe manual and harness evaluator entrypoints.
4. Runbooks describe frontend interaction evidence as step-bound proof.

### Done evidence
- migrated profile YAML files
- updated local skills
- updated ops docs and target-catalog guidance

### Out of scope
- upstream write-back enablement
- hosted production operations

---

## W27-S05 — Legacy cleanup and proof alignment
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Remove legacy live E2E report fields, fixtures, snapshots, and downgrade expectations without a compatibility layer.
- **Primary modules:** `examples/live-e2e/**`, `scripts/**`, `docs/product/**`, `docs/backlog/**`
- **Hard dependencies:** W27-S04
- **Primary user-story surfaces:** proof evidence, story traceability, and repository integrity surfaces

### Local tasks
1. Delete or rewrite fixtures that assert the old report shape.
2. Replace `verdict_matrix` outputs with `quality_judgement` where matrix naming only described quality evidence.
3. Remove test assertions for legacy verdict matrices and delivery downgrade semantics.
4. Align roadmap, master backlog, epic map, and dependency graph with W27.

### Acceptance criteria
1. No supported output includes legacy live E2E matrix fields.
2. Tests assert rejection or absence of old fields instead of compatibility.
3. Root integrity checks see W27 as the latest complete planning wave.

### Done evidence
- migrated proof fixtures
- updated backlog source-of-truth docs
- passing repository checks

### Out of scope
- backward-compatible readers
- migration adapters for historical runtime outputs
