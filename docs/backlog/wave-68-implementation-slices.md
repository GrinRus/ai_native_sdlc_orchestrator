# Wave 68 implementation slices — runtime model selection

## Purpose

Add provider-neutral runtime selection for model and reasoning effort. A route
may omit either value and let the selected runtime choose its native default;
an explicit value is validated by the adapter and mapped to adapter-owned
process arguments. Live E2E profiles may opt into an isolated model/effort
selection without changing the active W66 qualification baseline.

## W68-S01 — Contract and migration baseline for runtime selection

- **State:** blocked
- **Epic:** EPIC-0, EPIC-3, EPIC-4
- **Hard dependencies:** W67-S05
- **Primary modules:** route/adapter/execution contracts, examples, focused tests

**Purpose:** Make model and reasoning-effort selection explicit in route,
adapter, execution-profile, and evidence contracts while preserving old route
files and their compatibility semantics.

**Changes:**

- add optional `reasoning_effort` to route candidates;
- add adapter-supported effort values and adapter-owned effort argument mapping;
- document runner-native fallback and migration of legacy hidden live defaults;
- add a private live profile for Codex `gpt-5.6-luna` with `high` effort.

**Validation:** contract loader tests reject malformed nested values; all
existing examples still load; the new profile resolves through the catalog
without changing the required W66 matrix cells.

### Local tasks

1. **Define and validate the selection contract.** Purpose: establish optional
   model and effort fields. Changes: update contract docs, loaders, and
   fixtures. Validation: focused contract tests and example loading.
   - Purpose: Establish optional model and effort fields.
   - Changes: Update contract docs, loaders, and fixtures.
   - Validation: Run focused contract tests and example loading.

### Acceptance criteria

- Existing route and adapter examples remain loadable.

### Done evidence

- Contract test output and example-load report.

### Out of scope

- Provider-specific policy cutover and qualification baseline changes.

## W68-S02 — Runtime resolution and adapter argument mapping

- **State:** blocked
- **Epic:** EPIC-3, EPIC-4
- **Hard dependencies:** W68-S01
- **Primary modules:** provider-routing, adapter SDK, step-result evidence, tests

**Purpose:** Resolve explicit model/effort values before spawn and preserve
requested/effective/source fields in route and adapter projections.

**Changes:**

- external-process adapters return runner-native model defaults when a route
  omits `model`;
- explicit reasoning effort is validated against adapter capabilities;
- adapter-owned argument templates render model effort values at the process
  boundary;
- terminal request evidence carries model and reasoning-effort resolution.

**Validation:** adapter/provider-routing focused tests cover explicit,
unsupported, and omitted values plus argv mapping; root checks remain green.

### Local tasks

1. **Implement deterministic resolution.** Purpose: resolve values before
   spawn. Changes: update adapter negotiation and argv mapping. Validation:
   explicit, omitted, and unsupported focused tests.
   - Purpose: Resolve values before spawn.
   - Changes: Update adapter negotiation and argv mapping.
   - Validation: Cover explicit, omitted, and unsupported values.

### Acceptance criteria

- No external process starts with an unsupported explicit value.

### Done evidence

- Adapter and provider-routing focused test output.

### Out of scope

- Operator UI controls and live qualification certification.

## W68-S03 — Runtime selection projection and presets

- **State:** blocked
- **Epic:** EPIC-1, EPIC-3, EPIC-6
- **Hard dependencies:** W68-S02
- **Primary modules:** execution profile/readiness projections, CLI/API/web fixtures

**Purpose:** Expose selection in operator-facing execution projections without
  leaking provider-specific flags into the orchestrator core.

**Changes:** add resolved selection fields to execution-profile/readiness and
  route-attempt projections; define reusable provider-neutral presets for
  coding, planning, judge, and live E2E diagnostics.

**Validation:** projection fixtures preserve route IDs, source metadata, and
backward-compatible nulls when no explicit selection is present.

### Local tasks

1. **Project runtime selection.** Purpose: expose read-only effort metadata.
   Changes: update execution/readiness and attempt projections. Validation:
   projection fixtures and contract checks.
   - Purpose: Expose read-only effort metadata.
   - Changes: Update execution/readiness and attempt projections.
   - Validation: Run projection fixtures and contract checks.

### Acceptance criteria

- Projection rows preserve route identity and null compatibility.

### Done evidence

- Execution-profile/readiness projection fixtures.

### Out of scope

- New runtime stores or provider-specific flags in core.

## W68-S04 — Live E2E selection and Codex Luna/high rehearsal

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W68-S02
- **Primary modules:** private live profiles/materialization, runbook, proof tests

**Purpose:** Let a live profile select a concrete model and effort while keeping
  generated assets isolated and no-write by default.

**Changes:** materialize profile/provider runtime selection into pinned routes;
  suppress legacy adapter `default_args` only for an explicitly selected live
  run; retain source profiles and W66 evidence unchanged.

**Validation:** private proof-runner tests assert generated Codex routes contain
`gpt-5.6-luna` and `high`, generated permission modes have no duplicate legacy
model defaults, and other provider variants remain unchanged.

### Local tasks

1. **Materialize a selected live profile.** Purpose: prove isolated Codex
   selection. Changes: add profile and route/materialization assertions.
   Validation: focused private proof-runner test.
   - Purpose: Prove isolated Codex selection.
   - Changes: Add profile and route/materialization assertions.
   - Validation: Run the focused private proof-runner test.

### Acceptance criteria

- Generated assets carry Luna/high and never write upstream.

### Done evidence

- Isolated live-E2E materialization evidence and route snapshot.

### Out of scope

- Promoting the profile to the required W66 qualification matrix.

## W68-S05 — Cutover, certification, and docs closure

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W68-S03, W68-S04
- **Primary modules:** qualification ledger, runbooks, root gates

**Purpose:** Certify the new selection path and decide whether the default
  Codex live profile can move from the legacy pinned model to the runtime-native
  policy.

**Changes:** run isolated medium/large Codex rehearsals, record qualification
  evidence, remove migrated hidden defaults only after evidence closure, and
  update runbooks/README/backlog status.

**Validation:** deterministic gates, focused live-E2E proof, and a ledger-linked
cutover decision. No upstream writes or mutation of historical evidence.

### Local tasks

1. **Certify and decide cutover.** Purpose: close the migration with evidence.
   Changes: run qualification and update the ledger/runbook. Validation: root
   gates plus fresh isolated medium/large evidence.
   - Purpose: Close the migration with evidence.
   - Changes: Run qualification and update the ledger/runbook.
   - Validation: Run root gates plus fresh isolated evidence.

### Acceptance criteria

- Cutover is ledger-linked and reversible.

### Done evidence

- Qualification ledger decision and root-gate output.

### Out of scope

- Any upstream repository write or irreversible default change without evidence.
