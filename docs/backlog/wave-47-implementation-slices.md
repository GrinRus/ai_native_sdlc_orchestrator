# W47 implementation slices

W47 moves black-box product live E2E from classified terminal proof to the first
strict product acceptance closures. It keeps the W46 all-pass policy intact:
blocked runs remain non-accepted, run-health remains factual, and medium+
product acceptance requires independent step-quality plus final all-pass quality.

## W47-S01 — AOR operator keyboard accessibility and guided proof closure
- **Epic:** EPIC-6 Operator surface; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make the installed-user/operator web surface keyboard-provable so
  the guided AOR UI proof can pass every accessibility subdimension, especially
  `keyboard_navigation`.
- **Primary modules:** `apps/web/**`, `scripts/live-e2e/**`, tests
- **Hard dependencies:** W46-S06

### Local tasks
1. Add visible focus affordances for primary operator controls.
2. Require browser-task proof to record structured keyboard focus movement.
3. Hydrate guided proof/run-health from browser-task focus evidence.
4. Add web and guided-proof regression tests.

### Acceptance criteria
1. Primary flow, decision, artifact, interaction, and execution controls are
   keyboard-focusable with visible focus.
2. Guided browser-task proof records at least two distinct focused controls.
3. A non-pass AOR accessibility subdimension blocks paired product acceptance.
4. `installed-user-guided-journey.yaml` can produce all-pass UI/accessibility
   evidence when the browser proof is complete.

### Done evidence
- web focused tests
- guided proof tests
- fresh guided AOR UI proof run or classified blocker

### Out of scope
- weakening W46 all-pass product-quality gates
- broad redesign of the operator console beyond keyboard proof gaps

## W47-S02 — Live E2E target verification isolation and Vitest readiness
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Prevent live E2E runtime state from contaminating hard-target
  verification and classify target setup/environment blockers before product
  execution.
- **Primary modules:** `scripts/live-e2e/**`, `packages/orchestrator-core/**`,
  target catalog/profile docs, tests
- **Hard dependencies:** W47-S01

### Local tasks
1. Use isolated verification workspaces for medium+ product-change profiles.
2. Add Vitest Node engine and build readiness setup checks before execution.
3. Classify Node/build setup failures as setup/environment blockers.
4. Prove `.aor` runtime state does not get scanned by target lint/test commands.

### Acceptance criteria
1. Medium+ product-change generated project profiles default target verification
   to `workspace-clone` unless explicitly overridden.
2. Vitest setup fails before execution on unsupported Node or missing build
   preconditions.
3. `vitest-large` no longer fails because target lint scans live E2E `.aor`
   runtime JSON.
4. Canonical target changed-path evidence still comes from the target checkout.

### Done evidence
- live E2E runner/profile tests
- Vitest profile/catalog update
- fresh Vitest proof run or classified non-isolation blocker

### Out of scope
- treating target setup blockers as product acceptance
- making xlarge proof required

## W47-S03 — AOR repair/review convergence hardening
- **Epic:** EPIC-4 Quality platform; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make public repair iterations more actionable and diagnosable so
  Fastify repair proof can either converge or expose a precise provider/AOR
  quality blocker.
- **Primary modules:** `scripts/live-e2e/**`, `packages/orchestrator-core/**`,
  review/repair docs, tests
- **Hard dependencies:** W47-S02

### Local tasks
1. Preserve unresolved review findings, changed paths, verification status, and
   previous repair decisions in every repair iteration.
2. Include actionable repair context in public `review decide
   --decision request-repair` reason/evidence.
3. Distinguish stale findings, unaddressed provider changes, verification
   failures, and acceptable residual risk in repair summaries.
4. Keep repair routed only through public AOR review/repair lifecycle.

### Acceptance criteria
1. Repair iterations carry previous request/report lineage and unresolved
   findings.
2. Repeated repair attempts cannot silently repeat without new actionable
   context.
3. `fastify-repair-medium` either reaches approved review after repair or
   records a specific terminal blocker.
4. No runner/evaluator private target mutation is introduced.

### Done evidence
- repair-loop tests
- fresh Fastify repair proof run or classified convergence blocker

### Out of scope
- private runner mutation of target files
- bypassing public AOR review/repair lifecycle commands

## W47-S04 — Full proof rerun and product acceptance closure
- **Epic:** EPIC-0 Foundation; EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Re-run the required proof set after W47 fixes and claim product
  acceptance only for all-pass runs.
- **Primary modules:** `scripts/live-e2e/**`, `docs/ops/**`, root checks
- **Hard dependencies:** W47-S03

### Local tasks
1. Run same-commit `installed-user-guided-journey.yaml`.
2. Prepare, validate, and gate `httpx-medium` with paired AOR UI proof.
3. Run fresh `fastify-repair-medium`.
4. Run fresh `vitest-large`.
5. Update proof findings with run ids, statuses, blockers, and next tickets.

### Acceptance criteria
1. `guided-aor-ui` has all-pass UI/accessibility evidence or a classified
   blocker.
2. `httpx-medium` has final `quality-assessment gate --policy all-pass` before
   product acceptance is claimed.
3. Fastify and Vitest results are terminal pass or classified blocker; blocked
   runs are not counted as product acceptance.
4. `.aor/` runtime state and raw runtime artifacts remain uncommitted.

### Done evidence
- `pnpm live-e2e:test`
- `pnpm test`
- `pnpm build`
- `pnpm check`
- `pnpm slice:gate`
- `docs/ops/live-e2e-proof-complete-findings.md`

### Out of scope
- committing `.aor/` runtime state
- counting classified blocked proof runs as product acceptance
