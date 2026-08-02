# W53 implementation slices

W53 generalizes project verification into AOR command groups and keeps internal
live E2E proof harness semantics outside the orchestrator core. The wave is a
follow-up to W52 hard-target evidence: Vitest/SQLAlchemy remain examples of
broken baseline and long diagnostic behavior, not special-case product logic.

## W53-S01 — Generic verification command-group contract

- **Outcome:** Add `verification.command_groups[]` as the generic AOR
  verification contract while preserving legacy command fields.
- **Epic:** EPIC-4, EPIC-7
- **State:** done
- **Primary modules:** `docs/contracts/**`, `packages/contracts/**`,
  examples
- **Hard dependencies:** W52-S10

### Local tasks
1. Document command group fields, roles, phases, enforcement, and timeout
   classes.
2. Validate command-group enums in shared contract loading.
3. Keep legacy `build_commands`, `lint_commands`, `test_commands`, and CLI
   overrides loadable.

### Acceptance criteria
1. Invalid command-group role/phase/enforcement/timeout-class values fail
   contract validation.
2. Existing project profiles without command groups remain valid.
3. Example handoff and wave-ticket artifacts expose generic command groups.

### Done evidence
- contract-loader command-group validation tests
- updated contract docs and examples

### Out of scope
- live E2E run-health or quality-assessment policy changes

## W53-S02 — AOR project verify command-group execution

- **Outcome:** Execute verification command groups with generic enforcement and
  timeout-class evidence.
- **Epic:** EPIC-4
- **State:** done
- **Primary modules:** `packages/orchestrator-core/src/project-verify.mjs`,
  verifier tests
- **Hard dependencies:** W53-S01

### Local tasks
1. Normalize legacy profile and CLI commands into command groups.
2. Select groups by `verification_label` phase.
3. Record per-group status, enforcement result, timeout class, and step refs in
   verify summaries.

### Acceptance criteria
1. `required` failures fail verification.
2. `warn` failures produce warning evidence.
3. `observe` failures remain non-blocking evidence.
4. Timeout-class defaults apply unless an explicit profile timeout is present.

### Done evidence
- `project-verify` command-group regression tests

### Out of scope
- changing provider execution semantics

## W53-S03 — Live E2E adapter boundary mapping

- **Outcome:** Translate live E2E target catalog verification sugar into generic
  AOR command groups without exposing harness fields to AOR core.
- **Epic:** EPIC-7
- **State:** done
- **Primary modules:** `scripts/live-e2e/lib/target-materialization.mjs`,
  `scripts/live-e2e/lib/flows.mjs`, live E2E docs/tests
- **Hard dependencies:** W53-S02

### Local tasks
1. Materialize generated target project profiles with command groups for
   readiness, baseline, post-change primary, and diagnostics.
2. Stop using post-run legacy verify override args in live E2E flows.
3. Let explicit profile timeouts override command timeout classes; otherwise use
   class defaults.

### Acceptance criteria
1. Generated live E2E project profiles validate through the generic
   project-profile contract.
2. Post-run primary and diagnostic verification use `--verification-label`
   selection instead of regex command bucketing.
3. Run-health classification remains live E2E-only.

### Done evidence
- live E2E target materialization tests
- updated live E2E target catalog and runner docs

### Out of scope
- relaxing product acceptance gates

## W53-S04 — AOR/live E2E leak guards

- **Outcome:** Prevent runtime source from importing live E2E tooling or emitting
  live E2E-only fields.
- **Epic:** EPIC-0, EPIC-7
- **State:** done
- **Primary modules:** `packages/**`, `apps/**`, boundary tests
- **Hard dependencies:** W53-S03

### Local tasks
1. Add source guard coverage for production source in `packages/**` and
   `apps/**`.
2. Reject `scripts/live-e2e` imports and live E2E-only field names in AOR
   runtime source.
3. Allow live E2E reports to reference AOR artifacts, but not the reverse.

### Acceptance criteria
1. A production-source live E2E import or emitted harness field fails tests.
2. Test fixtures remain outside the guard.

### Done evidence
- AOR/live E2E boundary regression test

### Out of scope
- scanning historical docs or live E2E fixture bundles

## W53-S05 — Generic verification archetype fixtures

- **Outcome:** Prove command groups handle representative project shapes without
  target-specific fixes.
- **Epic:** EPIC-4, EPIC-7
- **State:** done
- **Primary modules:** verifier tests
- **Hard dependencies:** W53-S04

### Local tasks
1. Cover Node, Python-style setup, monorepo, no-tests, and broken-baseline
   profiles.
2. Assert AOR verify summaries stay free of live E2E-only terms.
3. Preserve legacy CLI override compatibility.

### Acceptance criteria
1. Each archetype produces the expected generic verification status.
2. Broken baseline is represented as a baseline required failure, not a live E2E
   blocker.
3. No archetype requires live E2E target matrix membership.

### Done evidence
- verifier archetype regression tests

### Out of scope
- hard-target product acceptance reruns
