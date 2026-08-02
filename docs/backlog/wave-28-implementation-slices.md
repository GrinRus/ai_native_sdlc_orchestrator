# W28 — Installed-user live E2E gap closure and matrix expansion

Close the remaining live E2E gaps after W27 by proving the AOR launcher before target execution, making full-lifecycle profiles execute their declared release/learning steps, and expanding the curated target matrix.

## Wave objective
Make live E2E closer to a real installed-user black-box evaluator by proving the source-installed AOR launcher, separating setup evidence from SDLC evidence, closing interaction/frontend/full-lifecycle gaps, and expanding required target coverage.

## Wave exit criteria
- Every live E2E run records AOR install proof and setup/prelude observations before SDLC step execution.
- Full-lifecycle profiles execute release and learning through public surfaces.
- Live E2E evaluator naming is separated from Runtime Harness replay/certification naming.
- Required target coverage includes Commander.js and pluggy; extended coverage includes Cobra and date-fns.

## Sequencing notes
- `W28-S01` updates the contract/profile/report surface before runner behavior depends on setup evidence.
- `W28-S02` follows install proof so full-lifecycle, interaction, frontend, and evaluator naming changes share the same controller model.
- `W28-S03` expands matrix coverage after profiles can carry the new required policy fields.

---

## W28-S01 — AOR install proof and setup journal
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Every live E2E report carries installed-user AOR launcher proof and setup/prelude evidence before the SDLC step journal.
- **Primary modules:** `docs/contracts/**`, `packages/contracts`, `scripts/live-e2e/**`, `examples/reports/**`
- **Hard dependencies:** W27-S05

### Local tasks
1. Add required `live_e2e.installation_policy` validation to live E2E profiles.
2. Run AOR source-install proof before the first public AOR command.
3. Add `aor_installation`, `aor_installation_proof_file`, and `setup_journal[]` to report and summary output.
4. Reject reports without setup/install proof or required step plans.

### Acceptance criteria
1. Profiles declare `live_e2e.installation_policy`.
2. Run summaries and observation reports include `aor_installation_proof_file` and `setup_journal[]`.
3. Contract validation rejects reports missing install proof or step plans.

### Done evidence
- updated live E2E report contract and sample
- profile policy validation
- proof-runner tests with source-install proof transcripts

### Out of scope
- npm/global AOR package distribution
- committing `.aor/` runtime install artifacts

## W28-S02 — Full-lifecycle and interaction gap closure
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Full-lifecycle profiles execute release and learning, deterministic interaction answers use only public answer surfaces, and guided frontend proof is tied to the learning observation.
- **Primary modules:** `scripts/live-e2e/**`, `.agents/skills/**`, `docs/ops/**`, tests
- **Hard dependencies:** W28-S01

### Local tasks
1. Make bounded `full_lifecycle` profiles execute release and learning instead of silently skipping them.
2. Submit deterministic auto answers only through public answer surfaces.
3. Persist guided AOR operator UI evidence before the learning step decision finalizes.
4. Rename the live E2E evaluator script and docs from harness-evaluator to step-evaluator.

### Acceptance criteria
1. Bounded full-lifecycle profiles run `release prepare`, `audit runs`, and `learning handoff`.
2. Deterministic auto-answer policy submits through `aor run answer`.
3. Guided frontend smoke evidence is present before the `learning` step is finalized.
4. Live E2E evaluator entrypoints use step-evaluator naming; Runtime Harness remains reserved for replay/certification.

### Done evidence
- controller and flow updates for release/learning, answer, and frontend ordering
- step-evaluator entrypoint and runbook updates
- live E2E proof-runner and controller tests

### Out of scope
- compatibility alias for the removed harness-evaluator script
- private runtime internals in the live E2E runner

## W28-S03 — Matrix target expansion
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** The live E2E target catalog includes Commander.js, pluggy, Cobra, and date-fns plus explicit profiles/cells for previously unused feature missions.
- **Primary modules:** `scripts/live-e2e/catalog/**`, `scripts/live-e2e/profiles/**`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** W28-S01

### Local tasks
1. Add Commander.js and pluggy target catalog entries with required matrix cells.
2. Add Cobra and date-fns target catalog entries as extended matrix candidates.
3. Promote ky/httpie/nextjs feature gaps into explicit cells and profiles.
4. Update runbook matrix docs, dependency matrix docs, and scorecard coverage notes.

### Acceptance criteria
1. `commander-js` and `pluggy` have required matrix cells and full-journey profiles.
2. `cobra` and `date-fns` are extended candidate targets.
3. Existing ky/httpie/nextjs feature gaps have explicit cells and profiles.

### Done evidence
- new target catalog YAML entries
- new full-journey profile YAML entries
- updated live E2E target catalog and dependency matrix docs

### Out of scope
- claiming required acceptance from bounded smoke-only profiles
- upstream writes to curated public repositories
