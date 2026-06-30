# W52 implementation slices

W52 turns W51's terminal hard-target evidence plus the latest large/xlarge live
E2E evidence into the next closure plan for the remaining product-acceptance
gaps. The wave closes target-readiness, diagnostic timeout, Codex provider
tool-surface, and manual xlarge step-quality hardening before rerunning Vitest
large and SQLAlchemy large. Follow-up slices then harden the quality of the
manual evidence, diagnostic classification, and final acceptance/observation
reporting. The wave must not weaken all-pass policy. A blocked hard-target run
stays non-accepted product quality until terminal run-health pass and final
`quality-assessment gate --policy all-pass` both pass.

## W52-S01 — Target-readiness owner propagation

- **Outcome:** Make run-health, run summary, observation report, and scorecard
  surface target-readiness owner, phase, and class at the top level when a run
  blocks before product execution.
- **Epic:** EPIC-7
- **State:** ready
- **Primary modules:** `scripts/live-e2e/run-profile.mjs`,
  `scripts/live-e2e/lib/**`, run-health examples/tests
- **Hard dependencies:** W51-S05

### Local tasks
1. Normalize top-level `failure_owner`, `failure_phase`, and `failure_class`
   from `target_readiness` whenever target readiness blocks before product
   execution.
2. Preserve nested `target_readiness` evidence for detailed diagnostics.
3. Add fixture coverage for Vitest-style target verification blockers.
4. Update findings examples to show the top-level and nested classifications.

### Acceptance criteria
1. A Vitest-style target verification block reports
   `target_repository/target_verification/target_verification_blocked` at the
   top level and inside `target_readiness`.
2. Product execution is still marked as not started.
3. Passing readiness and post-execution run-health behavior are unchanged.

### Done evidence
- run-health fixture tests
- updated findings/runbook example

### Out of scope
- changing product acceptance policy
- rerunning Vitest or SQLAlchemy before classification evidence is fixed

## W52-S02 — Diagnostic command hang and timeout hardening

- **Outcome:** Bound warning-mode diagnostic commands so terminal command output
  cannot leave `project verify`, `run-profile`, or `step-evaluator` stuck.
- **Epic:** EPIC-4, EPIC-7
- **State:** blocked
- **Primary modules:** `packages/orchestrator-core/**`,
  `scripts/live-e2e/**`, verification tests
- **Hard dependencies:** W52-S01

### Local tasks
1. Add explicit timeout/pipe-hang handling around target diagnostic command
   execution and child-process cleanup.
2. Preserve terminal stdout/stderr evidence and command exit classification
   before force cleanup.
3. Keep `diagnostic_failure_mode=warn` as warning evidence, not product
   acceptance.
4. Add regression coverage for a command that writes terminal output and then
   waits on a pipe.

### Acceptance criteria
1. A hanging warning-mode diagnostic exits the proof runner with run-health
   `warn`, not an indefinitely running process.
2. The diagnostic report records timeout/hang owner, phase, class, and evidence
   refs.
3. Primary verification and final all-pass policy remain strict.

### Done evidence
- verifier timeout/pipe-hang tests
- live E2E diagnostic-health fixture

### Out of scope
- treating warning diagnostics as product acceptance
- relaxing primary verification or final all-pass quality gates

## W52-S06 — Codex provider tool-surface hardening

- **Outcome:** Keep Codex/OpenAI provider failures classified as provider
  execution issues while removing host config/tool-surface noise from live E2E
  runs.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `examples/adapters/codex-cli.yaml`,
  `packages/adapter-sdk/**`, live adapter/run-health tests
- **Hard dependencies:** W52-S02

### Local tasks
1. Add `codex exec --ignore-user-config --ignore-rules` to Codex full-bypass
   and restricted live adapter args while preserving host authentication through
   the active `CODEX_HOME`.
2. Keep `--runner-auth-mode host` as the default; leave isolated auth as an
   explicit diagnostic/CI mode only.
3. Parse raw provider JSONL/stdout/stderr for OpenAI API schema/tool-call
   failures such as `invalid_request_error` and
   `property_name_above_max_length`.
4. Preserve classification as
   `provider/provider_execution/external-runner-failed` while surfacing a
   specific `raw_provider_error_summary` and provider-step recommended action.

### Acceptance criteria
1. Codex profile args include `--ignore-user-config --ignore-rules` immediately
   after `exec` for both permission modes.
2. Malformed Codex/OpenAI tool-call schema evidence is not classified as target
   readiness or target verification failure.
3. Raw evidence and `provider_step_status.recommended_action` name the malformed
   Codex/OpenAI tool-call schema failure.

### Done evidence
- adapter profile tests
- raw provider error fixture tests
- updated runner contract/runbook notes

### Out of scope
- enabling `runner-auth-mode=isolated` by default
- changing provider failures into target-repository blockers

## W52-S07 — Manual xlarge step-quality continuation

- **Outcome:** Allow manual-only xlarge live E2E runs to continue after an
  accepted operator decision by preparing the linked step-quality report through
  a public helper, without using the automatic step evaluator.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/manual-live-e2e.mjs`,
  `scripts/live-e2e/lib/step-quality-assessment.mjs`, controller tests
- **Hard dependencies:** W52-S02

### Local tasks
1. Add `manual-live-e2e.mjs --prepare-step-quality --request
   <step-quality-request> --decision continue|request-repair|retry|block`.
2. Write the expected
   `live-e2e-step-quality-assessment-report-*` file from the request, linked
   operator decision, and required public evidence refs.
3. Validate the report contract before writing and make ordinary
   `manual-live-e2e` resume consume the accepted report.
4. Keep xlarge outside `step-evaluator` and qualification-loop closure.

### Acceptance criteria
1. Xlarge discovery can stop on `pending_step_quality_assessment`, accept a
   manual `continue` report, clear the pending gate, and continue to `spec`.
2. Accepted manual reports use `assessment_method=manual-skill-agent` and cite
   non-empty public evidence refs from the request/operator decision.
3. Xlarge remains manual observation evidence and cannot close required
   acceptance or qualification coverage.

### Done evidence
- controller/manual helper tests
- updated live E2E runner runbook
- contract validation for generated reports

### Out of scope
- automatic xlarge step evaluation
- counting xlarge observation evidence as product acceptance

## W52-S03 — Vitest large product acceptance closure

- **Outcome:** Rerun Vitest large after W52-S01/S02/S06/S07 and either reach
  final all-pass product acceptance or record a precise non-W51 blocker.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml`,
  target catalog, proof findings
- **Hard dependencies:** W52-S02, W52-S06, W52-S07

### Local tasks
1. Reuse the compatible Node binary through `AOR_LIVE_E2E_TARGET_NODE_BIN`.
2. Investigate the W51 baseline `pnpm test` target-verification blocker and
   decide whether the profile needs a target-appropriate scoped verification
   command or the target repository has a real baseline blocker.
3. Run a fresh same-commit guided UI proof plus Vitest large proof.
4. If the product flow reaches terminal pass, prepare, validate, and gate final
   quality with paired UI proof.

### Acceptance criteria
1. No W50/W51 setup regressions recur: incompatible Node, missing CLI artifact,
   and `.aor` source scanning remain closed.
2. Product acceptance is claimed only after terminal run-health pass and final
   all-pass gate.
3. If blocked, owner/phase/class identifies target baseline, environment, AOR,
   or provider without collapsing into generic setup failure.

### Done evidence
- fresh Vitest run summary
- target-readiness or product-flow evidence
- final quality report or classified blocker

### Out of scope
- weakening Vitest setup isolation
- counting blocked readiness as product acceptance

## W52-S04 — SQLAlchemy large diagnostic policy and acceptance closure

- **Outcome:** Resolve the SQLAlchemy full-suite diagnostic ambiguity and rerun
  SQLAlchemy large toward product acceptance or a precise diagnostic blocker.
- **Epic:** EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/profiles/full-journey-regress-sqlalchemy-large-openai.yaml`,
  target catalog, quality reports
- **Hard dependencies:** W52-S02, W52-S06, W52-S07

### Local tasks
1. Decide whether SQLAlchemy hard-target acceptance requires full `pytest test`
   or whether mission-relevant primary verification plus documented diagnostic
   warning is sufficient.
2. If full-suite remains required, make the profile environment satisfy the
   full-suite prerequisites or classify target-only failures precisely.
3. Rerun same-commit guided UI proof plus SQLAlchemy large proof.
4. Prepare, validate, and gate final quality only when run-health is terminal
   pass and diagnostic policy is satisfied.

### Acceptance criteria
1. SQLAlchemy diagnostic policy is explicit in catalog/profile docs.
2. Warning-mode diagnostics cannot hang the proof runner.
3. Product acceptance is claimed only after final all-pass gate.
4. If blocked, the blocker distinguishes target diagnostic failures from AOR
   runner defects.

### Done evidence
- updated SQLAlchemy profile/catalog policy
- fresh SQLAlchemy run summary
- final quality report or classified blocker

### Out of scope
- hiding full-suite failures as accepted product quality
- adding Django or optional xlarge coverage

## W52-S05 — Hard-target proof rerun and findings sync

- **Outcome:** Record the final W52 Vitest/SQLAlchemy outcomes and keep backlog
  state aligned with product acceptance truth.
- **Epic:** EPIC-0, EPIC-7
- **State:** blocked
- **Primary modules:** `docs/ops/live-e2e-proof-complete-findings.md`,
  backlog docs, root checks, proof artifacts
- **Hard dependencies:** W52-S03, W52-S04

### Local tasks
1. Update findings with run ids, source commit SHAs, terminal statuses,
   owner/phase/class, final gate status, and next tickets.
2. Keep accepted product quality separate from terminal classified evidence.
3. Run root checks and slice gates.
4. Confirm `.aor/` and `/tmp/aor-*` runtime artifacts remain uncommitted.

### Acceptance criteria
1. Vitest and SQLAlchemy rows explicitly say product-accepted or
   not-product-accepted.
2. Blocked/warn runs are not counted as product acceptance.
3. `pnpm slice:status` selects the next appropriate slice after W52.

### Done evidence
- committed findings update
- passing root checks
- clean runtime artifact status

### Out of scope
- committing raw `.aor/` or `/tmp/aor-*` runtime state
- claiming product acceptance for blocked or warning runs

## W52-S08 — Manual step-quality assessment depth

- **Outcome:** Make manual product-change step-quality reports review-grade
  instead of merely contract-valid by requiring step-specific evidence summaries,
  per-dimension inspected refs, and fail-closed validation for generic accepted
  reports.
- **Epic:** EPIC-4, EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/lib/step-quality-assessment.mjs`,
  `scripts/live-e2e/manual-live-e2e.mjs`,
  `scripts/live-e2e/docs/contracts/live-e2e-step-quality-assessment-report.md`,
  controller/manual tests
- **Hard dependencies:** W52-S05

### Local tasks
1. Extend manual step-quality report validation so accepted product-change
   reports require non-empty step-specific findings and inspected refs for every
   required dimension.
2. Have `manual-live-e2e.mjs --prepare-step-quality` preserve the convenience
   helper path while producing richer per-dimension summaries from the linked
   request and operator-decision evidence.
3. Add negative fixtures for accepted reports that only contain generic pass
   text or lack per-dimension public evidence refs.
4. Update the live E2E runner runbook to describe the difference between
   manual skill-agent assessment, automatic evaluator reports, and independent
   product acceptance.

### Acceptance criteria
1. A manual xlarge report with generic accepted text but missing dimension-level
   evidence fails validation before continuation.
2. Valid manual reports cite public evidence refs per required dimension and
   include step-specific findings for execution, review, QA, delivery, and
   learning.
3. Manual xlarge evidence remains observation evidence and cannot close product
   acceptance without a separate accepted large all-pass gate.

### Done evidence
- report contract/validator tests
- manual helper regression tests
- updated live E2E runbook text

### Out of scope
- replacing manual xlarge review with `step-evaluator`
- requiring a human-only external reviewer for internal maintainer rehearsals

## W52-S09 — Diagnostic command classification precision

- **Outcome:** Replace substring-based diagnostic command detection with explicit
  command metadata so non-diagnostic labels cannot be misclassified as
  diagnostic warnings or blockers.
- **Epic:** EPIC-4, EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/lib/flows.mjs`,
  `scripts/live-e2e/run-profile.mjs`,
  `scripts/live-e2e/docs/contracts/live-e2e-run-health-report.md`,
  proof-runner tests
- **Hard dependencies:** W52-S05

### Local tasks
1. Carry an explicit diagnostic intent field from post-run diagnostic command
   construction into command diagnostics and run-health summaries.
2. Remove reliance on `label.includes("diagnostic")` for owner/phase/class
   selection while preserving existing diagnostic timeout evidence.
3. Add fixtures for false-positive labels that contain the word `diagnostic`
   but are not diagnostic commands.
4. Update run-health contract/runbook examples to show explicit diagnostic
   command metadata.

### Acceptance criteria
1. Only commands marked as diagnostic receive diagnostic timeout/warning
   classification.
2. Existing post-run diagnostic timeout fixtures still preserve stdout/stderr
   transcript refs and bounded cleanup evidence.
3. Primary verification failures are never downgraded because of a label string.

### Done evidence
- proof-runner classification tests
- updated run-health contract/runbook example
- root slice gate

### Out of scope
- changing diagnostic warning policy
- weakening primary verification or all-pass quality gates

## W52-S10 — Acceptance evidence matrix and xlarge observation reporting

- **Outcome:** Produce a durable final evidence matrix that separates product
  acceptance, paired guided UI proof, manual xlarge observation, delivery
  safety, and learning handoff quality for reviewers.
- **Epic:** EPIC-0, EPIC-7
- **State:** blocked
- **Primary modules:** `scripts/live-e2e/quality-assessment.mjs`,
  `scripts/live-e2e/run-profile.mjs`,
  `docs/ops/live-e2e-proof-complete-findings.md`, backlog docs
- **Hard dependencies:** W52-S08, W52-S09

### Local tasks
1. Add a post-run evidence matrix artifact or findings section that records run
   id, profile, terminal run-health, all-pass gate status, guided UI proof
   status, xlarge observation status, delivery mode, no-upstream-write evidence,
   and learning handoff refs.
2. Hydrate delivery manifest summaries from `repo_deliveries[]` so reviewers see
   changed paths, diff totals, patch-only status, and writeback result without
   custom `jq` inspection.
3. Hydrate learning handoff summaries with scorecard/evidence refs and next
   actions while keeping compact report contracts valid.
4. Update findings/backlog language so xlarge pass is never described as product
   acceptance.

### Acceptance criteria
1. A final W52 findings update can distinguish `product-accepted`,
   `manual-observation-pass`, `blocked`, and `not-product-accepted` states
   without reading raw runtime directories.
2. Delivery safety evidence includes patch-only/writeback status and changed
   path totals for the target repo.
3. Learning evidence includes scorecard refs and follow-up backlog refs.
4. Product acceptance remains limited to terminal large run-health pass,
   accepted step-quality, meaningful target change, paired UI proof when
   required, and `quality-assessment gate --policy all-pass`.

### Done evidence
- generated/updated evidence matrix or findings section
- tests or fixture validation for delivery and learning summary hydration
- updated backlog/finding sync after W52 hard-target reruns

### Out of scope
- counting manual xlarge observation as provider qualification or product
  acceptance
- committing raw runtime artifacts
