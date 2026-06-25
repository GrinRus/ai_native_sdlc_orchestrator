# W51 implementation slices

W51 turns W50's implementation-hardening and classified proof into stricter
proof-complete closure. The wave focuses on clean-commit evidence, one accepted
large hard target, lower-manual-effort final quality assessment, clearer
pre-execution phase semantics, and one additional hard-target expansion only
after the current required proof set is stable.

## W51-S01 — Clean-commit W50 proof rerun

- **Outcome:** Re-run the accepted W50 guided, HTTPX, and Fastify proofs on a
  clean committed AOR SHA so product-acceptance evidence is tied to immutable
  source instead of a dirty worktree label.
- **Epic:** EPIC-0, EPIC-7
- **State:** ready
- **Primary modules:** `docs/ops/live-e2e-proof-complete-findings.md`,
  `scripts/live-e2e/**`, root checks, live proof artifacts
- **Hard dependencies:** W50-S04

### Local tasks
1. Commit W50 source/docs/tests before proof execution.
2. Re-run `installed-user-guided-journey.yaml`,
   `full-journey-regress-httpx-medium-openai.yaml`, and
   `full-journey-repair-fastify-medium-openai.yaml` on the committed SHA.
3. Prepare, validate, and gate final quality reports for HTTPX and Fastify with
   the same-commit guided UI/accessibility proof.
4. Update proof findings with run ids, commit SHA, gate results, and artifact
   hygiene confirmation.

### Acceptance criteria
1. Guided AOR UI run passes and includes browser-task/accessibility evidence.
2. HTTPX medium and Fastify repair medium both have terminal run-health pass and
   final `quality-assessment gate --policy all-pass`.
3. Findings do not claim product acceptance from dirty-worktree evidence.

### Done evidence
- clean-commit run ids
- final validate/gate outputs
- updated proof findings doc

### Out of scope
- Vitest large acceptance
- committing `.aor/` runtime artifacts

## W51-S02 — Vitest compatible Node large acceptance

- **Outcome:** Run Vitest large with a compatible target Node binary and either
  reach final all-pass product acceptance or record a new non-W50 blocker after
  target setup genuinely proceeds.
- **Epic:** EPIC-7
- **State:** blocked
- **External blocker:** compatible Node binary for
  `AOR_LIVE_E2E_TARGET_NODE_BIN` or compatible host Node is required.
- **Primary modules:** `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml`,
  `scripts/live-e2e/**`, `docs/ops/live-e2e-proof-complete-findings.md`
- **Hard dependencies:** W51-S01

### Local tasks
1. Provision or select Node satisfying `^22.12.0 || ^24.0.0 || >=26.0.0`.
2. Run the Vitest large profile with `AOR_LIVE_E2E_TARGET_NODE_BIN` set.
3. Verify target setup proceeds past toolchain preflight and old W46/W49 setup
   blockers do not recur.
4. Prepare, validate, and gate final quality if the run reaches terminal pass;
   otherwise classify the new blocker by owner, phase, and class.

### Acceptance criteria
1. Incompatible Node no longer reaches target install/build/test/lint.
2. Compatible Node proceeds past target setup into product flow or records a
   new non-W50 blocker.
3. Product acceptance is claimed only after final all-pass gate.

### Done evidence
- Vitest large run summary
- target toolchain/preflight evidence
- final quality report or classified blocker record

### Out of scope
- making Vitest optional required coverage
- weakening hard-target verification commands

## W51-S03 — Automated final quality report hydration

- **Outcome:** Reduce manual final-quality report assembly by generating a
  complete draft from quality-assessment requests, run summary, run-health,
  step-quality reports, changed paths, review/QA/delivery evidence, and paired
  AOR UI proof.
- **Epic:** EPIC-4, EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/quality-assessment.mjs`,
  `scripts/live-e2e/lib/**`, `packages/contracts/**`, tests
- **Hard dependencies:** W51-S02

### Local tasks
1. Add a draft report hydration mode that materializes all required dimensions
   with evidence refs and explicit unknown gaps.
2. Pull meaningful changed paths, target verification refs, step-quality
   lineage, review findings, QA findings, delivery refs, and paired UI proof
   refs from public artifacts.
3. Keep SWE evaluator authority for final judgement while preventing empty
   all-pass drafts.
4. Add tests for missing evidence, weak UI proof, empty changed paths, and
   non-passing verification.

### Acceptance criteria
1. Draft reports validate against the final quality contract before manual
   evaluator edits.
2. Draft all-pass is impossible when required evidence is missing or weak.
3. HTTPX/Fastify reports can be regenerated from public artifacts with only
   evaluator judgement edits.

### Done evidence
- quality-assessment hydration tests
- sample hydrated report fixture
- updated quality-assessment runbook

### Out of scope
- replacing the SWE evaluator with a deterministic oracle
- relaxing all-pass policy

## W51-S04 — Explicit target-readiness phase

- **Outcome:** Separate target setup/toolchain blockers from product execution
  in run summaries, observation reports, and step-quality lineage.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/lib/flows.mjs`,
  `scripts/live-e2e/lib/step-controller.mjs`,
  `scripts/live-e2e/run-profile.mjs`, contracts/docs/tests
- **Hard dependencies:** W51-S03

### Local tasks
1. Add first-class `target-readiness` or `pre-execution` phase semantics for
   target setup/toolchain verification before implementation steps.
2. Preserve backwards-breaking policy for active live E2E profiles while
   updating contracts, examples, run summaries, observation reports, and tests.
3. Ensure readiness blockers never appear as product execution failures.
4. Update findings/runbooks to explain readiness-vs-execution classification.

### Acceptance criteria
1. Vitest incompatible Node blocks in target-readiness, not execution.
2. Medium+ product-change flow still requires accepted step-quality reports for
   observed product steps.
3. Existing W50 HTTPX/Fastify acceptance remains reproducible after the phase
   split.

### Done evidence
- contract/runner tests for target-readiness
- updated runbook and findings examples
- control proof rerun or classified blocker after phase split

### Out of scope
- changing AOR product lifecycle step names outside live E2E reporting
- weakening product execution evidence requirements

## W51-S05 — Next hard-target expansion after large acceptance

- **Outcome:** Add one additional required hard-target proof candidate only
  after Vitest large has terminal all-pass or a new accepted blocker policy.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/catalog/**`,
  `scripts/live-e2e/profiles/**`, `docs/ops/**`, `docs/backlog/**`
- **Hard dependencies:** W51-S04

### Local tasks
1. Choose exactly one next hard target from Biome, Ruff, or SQLAlchemy based on
   setup reliability and mission complexity.
2. Define a product-change mission with meaningful target paths, verification
   commands, budgets, and final code rubric.
3. Add profile/catalog tests without expanding xlarge required coverage.
4. Run or schedule the proof and record terminal evidence.

### Acceptance criteria
1. Expansion does not happen before current large proof policy is settled.
2. The new hard target is medium+/large product-change, not a flow canary.
3. Required matrix coverage remains explicit and excludes optional xlarge.

### Done evidence
- catalog/profile diff
- profile validation tests
- proof findings update

### Out of scope
- adding Django as required coverage
- making nextjs xlarge part of required qualification
