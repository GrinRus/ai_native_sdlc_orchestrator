# Wave 69 implementation slices — intent-first correctness and UI parity

## Purpose

Close the remaining contract, runtime read-model, navigation, and visual
parity gaps in the intent-first installed console. W69 is additive over the
W67/W68 surfaces, keeps the browser as a read/action consumer, and does not
change the historical W66 qualification matrix or Anthropic hold.

## W69-S01 — Intent confirmation CAS and contract parity

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W68-S05
- **Primary modules:** intent contracts, control-plane API/OpenAPI, intent service, HTTP handlers
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Ensure confirmation compiles exactly the server revision reviewed
by the operator and expose the additive CAS/recovery contract.

**Changes:** Add `expected_revision`, stable stale-revision error and refresh
recovery action; preserve idempotent `confirm` and legacy
`confirm-and-start`; align docs, OpenAPI, examples, and validators.

### Local tasks

1. **Define the CAS contract.**
   - Purpose: Make stale confirmation explicit.
   - Changes: Update intent and control-plane contracts.
   - Validation: Run contract and reference checks.
2. **Implement service and HTTP guard.**
   - Purpose: Reject stale revisions before Mission creation.
   - Changes: Compare the latest normalization revision and return structured recovery.
   - Validation: Run focused intent and HTTP API tests.
3. **Prove compatibility.**
   - Purpose: Preserve legacy start behavior and idempotency.
   - Changes: Retain the legacy action path and response lineage.
   - Validation: Run the intent-service regression suite.

### Acceptance criteria

- Stale confirmation returns `409 intent_submission.stale_revision` and creates no Mission/Flow.
- Matching confirmation returns `flow_id`, normalization revision, next action, and report ref.
- Repeated confirmation returns the same durable Flow.

### Done evidence

- Intent service, HTTP transport, contract, and reference test output.

### Out of scope

- Provider qualification policy and upstream writes.

## W69-S02 — Runtime-owned Flow projection and adaptive lifecycle

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-6
- **Hard dependencies:** W69-S01
- **Primary modules:** flow path/projection, next-action read model, OpenAPI, projection tests
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Make lifecycle states, skip reasons, evidence refs, and Home
summary fields server-owned and deterministic.

**Changes:** Project `display_title`, `work_type`, `current_step_label`, counts,
stable timestamps, and `lifecycle_path.steps[]` with completed/current/upcoming/
blocked/skipped states. Preserve compatibility fallback for older artifacts.

### Local tasks

1. **Define lifecycle read shape.**
   - Purpose: Establish one runtime path contract.
   - Changes: Update API docs/OpenAPI and canonical examples.
   - Validation: Run schema and reference checks.
2. **Project runtime decisions.**
   - Purpose: Consume report-owned states/reasons/evidence without browser inference.
   - Changes: Update flow path and projection builders.
   - Validation: Run adaptive projection fixtures.
3. **Separate summary counts.**
   - Purpose: Distinguish attention from blockers.
   - Changes: Project report attention metadata independently.
   - Validation: Run count and completed-flow tests.

### Acceptance criteria

- Browser receives all path states/reasons/evidence refs from the projection.
- `attention_count` and `blocker_count` are independent fields.
- `current_step_label` is human-readable and stable.

### Done evidence

- Flow projection tests for read-only/change, blocked/skipped, and completed paths.

### Out of scope

- New orchestration ownership in the web client.

## W69-S03 — Project Home resume-safe navigation

- **State:** blocked
- **Epic:** EPIC-1, EPIC-6
- **Hard dependencies:** W69-S02
- **Primary modules:** SPA surface state, Project Home, control-plane client, browser tests
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Make returning-user navigation deterministic without implicit Flow
selection.

**Changes:** Default to Home when a resumable Intent exists, keep URL surface
state across reload, offer Resume/New intent, and keep lifecycle chrome absent
before Flow selection.

### Local tasks

1. **Resolve default surface.**
   - Purpose: Choose Home for resumable work.
   - Changes: Derive surface from durable Intent/Flow reads.
   - Validation: Run the reload browser scenario.
2. **Preserve URL selection.**
   - Purpose: Restore project/intent/flow/mode context.
   - Changes: Centralize surface writes and selection guards.
   - Validation: Run history and reload tests.
3. **Verify pre-Flow shell.**
   - Purpose: Prevent lifecycle leakage.
   - Changes: Keep QuietShell and Flow selector Flow-scoped.
   - Validation: Run the responsive pre-Flow browser matrix.

### Acceptance criteria

- Root reload with saved Intent and no Flow opens Project Home.
- Resume opens the exact Prepared Task; New intent starts a clean draft.
- No lifecycle rail or Flow selector appears on pre-Flow surfaces.

### Done evidence

- Browser Home/resume/reload and responsive test output.

### Out of scope

- Adding a router dependency.

## W69-S04 — Review-first Prepared Task

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W69-S01, W69-S03
- **Primary modules:** intent onboarding, UI primitives/tokens, browser tests
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Align Prepared Task behavior with the review-first contract and
prevent accidental confirmation of local edits.

**Changes:** Add read-only summary/edit mode, dirty/save lifecycle, confidence,
assumptions, open questions, planned path, CAS payload, and stale recovery.

### Local tasks

1. **Build review surface.**
   - Purpose: Make server normalization the visible source.
   - Changes: Add read-only fields and summary metadata.
   - Validation: Run component and browser assertions.
2. **Build edit state.**
   - Purpose: Make local changes explicit.
   - Changes: Add Edit/Cancel/Save revision and dirty guards.
   - Validation: Run keyboard and dirty-state tests.
3. **Connect safe confirmation.**
   - Purpose: Send exactly the reviewed revision.
   - Changes: Add expected revision and recovery refresh.
   - Validation: Run stale and matching confirmation tests.

### Acceptance criteria

- Prepared Task is read-only until Edit is chosen.
- Confirm is disabled while dirty/editing and carries `expected_revision` after save.
- Displayed scope/acceptance equal the confirmed Mission inputs.

### Done evidence

- Intent component tests and browser review/edit/confirm scenarios.

### Out of scope

- Provider start from confirmation.

## W69-S05 — Flow Cockpit context and runtime path presentation

- **State:** blocked
- **Epic:** EPIC-1, EPIC-3, EPIC-6, EPIC-7
- **Hard dependencies:** W69-S02, W69-S03, W69-S04
- **Primary modules:** Flow Cockpit, QuietShell, quiet modes, responsive styles, browser tests
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Surface Project/Flow context and one server-owned next action
without duplicating runtime decisions in the UI.

**Changes:** Add Flow title/work type/current step/status header, render blocked
and skipped path states, preserve Cockpit/Attention/Journey/Evidence modes,
and keep completed flows immutable.

### Local tasks

1. **Add context header.**
   - Purpose: Orient the operator at every viewport.
   - Changes: Add title, work type, step, and status.
   - Validation: Run desktop and mobile browser assertions.
2. **Render adaptive states.**
   - Purpose: Show runtime-owned reasons and evidence.
   - Changes: Add QuietShell state attributes and accessible labels.
   - Validation: Run projection fixture rendering tests.
3. **Verify action ownership.**
   - Purpose: Retain one safe action.
   - Changes: Use `primary_action.operator_control` and preserve the Discovery boundary.
   - Validation: Run the exactly-once Discovery scenario.

### Acceptance criteria

- Cockpit header shows human-readable Flow context on mobile and desktop.
- The browser does not calculate next action, skip, or lifecycle state.
- Completed Flow remains read-only and follow-up uses a new Intent.

### Done evidence

- Cockpit mode, accessibility, responsive, and exactly-once action tests.

### Out of scope

- New runtime commands or provider adapters.

## W69-S06 — Incremental SPA decomposition and semantic visual cleanup

- **State:** blocked
- **Epic:** EPIC-0, EPIC-6, EPIC-7
- **Hard dependencies:** W69-S05
- **Primary modules:** SPA surface composition, UI tokens/components, CSS, parity tests
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Reduce UI maintenance risk while preserving the single runtime
client and existing behavior.

**Changes:** Extract routing/surface composition incrementally, remove only
proven dead branches, replace new raw color fallbacks with semantic tokens,
and add destructive/neutral status variants.

### Local tasks

1. **Extract surface composition.**
   - Purpose: Bound the root component.
   - Changes: Move route/screen composition behind existing client state.
   - Validation: Run source and browser parity tests.
2. **Align visual tokens.**
   - Purpose: Keep new surfaces on the semantic system.
   - Changes: Add tokens, variants, and focus/disabled/destructive states.
   - Validation: Run UI foundation and screenshot checks.
3. **Remove verified dead code.**
   - Purpose: Reduce stale renderer debt safely.
   - Changes: Delete only unused branches after parity.
   - Validation: Run quality ratchet and bundle smoke tests.

### Acceptance criteria

- No new raw hex values are introduced on W69 surfaces.
- Existing focus, reduced-motion, mobile, and destructive states remain accessible.
- Root composition changes preserve project/flow selection semantics.

### Done evidence

- UI implementation QA matrix, source ratchet, and browser parity output.

### Out of scope

- Big-bang SPA rewrite or new UI library.

## W69-S07 — Visual proof, story traceability, and closure

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-7
- **Hard dependencies:** W69-S06
- **Primary modules:** browser/reference tests, product/backlog docs, live qualification runbook
- **External blocker:** W66-S09/W68-S05 qualification hold remains open.

**Purpose:** Close W69 with reviewable evidence while preserving the historical
W66 qualification policy.

**Changes:** Add reference/screenshot assertions for Home, New Intent, Prepared
Task, and Cockpit; update user-story coverage and W69 docs; run deterministic
gates plus Codex medium/large qualification only.

### Local tasks

1. **Trace user outcomes.**
   - Purpose: Map returning-user and intent-first stories to routes, contracts, and evidence.
   - Changes: Update story matrix and backlog notes.
   - Validation: Run story traceability checks.
2. **Run visual/accessibility proof.**
   - Purpose: Verify supported viewports and states.
   - Changes: Add screenshot/reference and keyboard scenarios.
   - Validation: Run browser and reference gates.
3. **Run closure gate.**
   - Purpose: Produce final repository evidence.
   - Changes: Run root checks, slice gate, and Codex qualification.
   - Validation: Run every command in the W69 acceptance matrix.

### Acceptance criteria

- All W69 invariants have executable test evidence.
- Codex medium/large qualification is current acceptance; Anthropic/W66 hold remains documented.
- No runtime state, secrets, or upstream writes enter the commit.

### Done evidence

- Gate logs, browser artifacts, reference report, story matrix, and qualification journal.

### Out of scope

- Removing the historical W66 four-cell hold.
