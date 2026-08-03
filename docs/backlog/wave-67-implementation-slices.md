# W67 - central AOR Home and intent-first onboarding

## Goal

Move mutable AOR state out of connected repositories and replace topology-first
setup with one source-plus-intent ingress that prepares a bounded task before
write-capable execution.

## Dependency order

`W66-S09 -> W67-S01 -> {W67-S02, W67-S03} -> W67-S04 -> W67-S05`

## W67-S01 — Storage and contract baseline

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W66-S09
- **Outcome:** `~/.aor` becomes the only default mutable state root and the
  breaking project, evidence, intent, and export contracts are reviewable.
- **Primary modules:** product, architecture, contracts, examples, backlog
- **Primary user-story surfaces:** PBO-09, PBO-10, product-owner intake

### Local tasks

1. **Define the storage cutover.**
   - Purpose: Separate AOR-owned mutable state from repository-owned files.
   - Changes: Define AOR Home, workspace/storage identity, logical evidence
     refs, permissions, and the no-legacy-read boundary.
   - Validation: Architecture, contract, ADR, and examples agree.
2. **Define source and intent contracts.**
   - Purpose: Preserve raw operator input before normalized Mission evidence.
   - Changes: Add workspace registry, intent submission, normalization report,
     and evidence export manifest families.
   - Validation: Contract loader accepts canonical examples and rejects unsafe
     paths, attachments, and identifiers.
3. **Register W67.**
   - Purpose: Keep the breaking initiative out of the active W66 qualification.
   - Changes: Update roadmap, backlog, epic map, dependency graph, and stories.
   - Validation: Slice tools report W67 blocked behind W66-S09.

### Acceptance criteria

1. `AOR_HOME` or `~/.aor` is the only default mutable state root.
2. Portable `.aor/project.yaml` and explicit exports are the only planned
   repository writes.
3. Runtime and workspace identities cannot collide for same-name repositories.
4. Raw intent and normalized intent are separate durable contract families.

### Done evidence

- Contract docs and examples
- ADR and architecture updates
- Backlog and story traceability updates

### Out of scope

- Reading or migrating legacy repo-local runtime state
- Paid provider qualification

## W67-S02 — Project source connection and central runtime

- **State:** blocked
- **Epic:** EPIC-1, EPIC-6
- **Hard dependencies:** W67-S01
- **Outcome:** Local Git folders and Git URLs connect to collision-safe projects
  whose mutable state and managed clones live under AOR Home.
- **Primary modules:** orchestrator core, CLI, API, project-source tests
- **Primary user-story surfaces:** project bootstrap and repository owner

### Local tasks

1. **Implement central project contexts.**
   - Purpose: Isolate mutable state by collision-safe Workspace identity.
   - Changes: Resolve AOR Home, storage project keys, registry persistence, and managed layout.
   - Validation: Same-name fixtures remain isolated without repository writes.
2. **Connect local and remote Git sources.**
   - Purpose: Give CLI, API, and web one code-source contract.
   - Changes: Validate local Git roots and asynchronously clone sanitized Git URLs with atomic publication.
   - Validation: Local, HTTPS, SSH, duplicate, auth-failure, and retry tests pass.
3. **Expose native folder selection.**
   - Purpose: Avoid requiring operators to type local paths when desktop selection is available.
   - Changes: Add loopback macOS, Windows, and Linux picker adapters plus manual fallback.
   - Validation: Platform mocks and unavailable-picker behavior pass.
4. **Add source lifecycle actions.**
   - Purpose: Separate connection state from destructive data removal.
   - Changes: Add refresh, disconnect-with-preservation, and confirmed AOR-data deletion.
   - Validation: Disconnect preserves data and deletion requires exact confirmation.

### Acceptance criteria

1. Connecting a project creates no target-repository files.
2. Same-name repositories receive distinct stable workspace project IDs.
3. Credential-bearing Git URLs are rejected and clone failures are recoverable.
4. Folder-picker unavailability leaves manual path entry usable.

### Done evidence

- Core/API/CLI tests
- Platform picker mocks
- Managed-clone recovery fixtures

### Out of scope

- AOR-managed credentials
- Automatic upstream writes

## W67-S03 — Durable intent preparation

- **State:** blocked
- **Epic:** EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W67-S01
- **Outcome:** Text and bounded text attachments become immutable submissions
  that a read-only route normalizes into a reviewable task draft.
- **Primary modules:** contracts, orchestrator core, routes/prompts/policies, CLI, API
- **Primary user-story surfaces:** product-owner intake and runner setup

### Local tasks

1. **Persist bounded submissions.**
   - Purpose: Preserve immutable raw operator intent before interpretation.
   - Changes: Store text, generated attachment names, metadata, digests, and revision lineage.
   - Validation: UTF-8, extension, traversal, count, size, and restart tests pass.
2. **Normalize intent through a read-only route.**
   - Purpose: Produce a bounded task preview without asking users for packet syntax.
   - Changes: Add runner-agnostic routes, prompt, structured output, and deterministic validation.
   - Validation: Ready, missing, aliased, and malformed provider cases remain explicit.
3. **Implement submission transitions.**
   - Purpose: Make preparation recoverable and confirmation idempotent.
   - Changes: Add answer, revise, retry, cancel, confirm/start, and retry-start actions.
   - Validation: No failed preparation creates a partial Flow or duplicate confirmation.
4. **Compile accepted preview into intake evidence.**
   - Purpose: Preserve compatibility with existing goals, KPI, and DoD execution machinery.
   - Changes: Mechanically map outcome and acceptance into intake-request fields.
   - Validation: Created Flow retains normalized scope and safety mode.

### Acceptance criteria

1. Text or at least one supported attachment is required.
2. Preparation has no write tools or upstream capability.
3. Provider/output failures preserve a retryable submission without a Flow.
4. Confirmation is idempotent and never duplicates intake or Flow evidence.

### Done evidence

- Contract and transition tests
- Missing-provider and malformed-output fixtures
- CLI/API parity tests

### Out of scope

- Binary documents, images, OCR, or SaaS connectors

## W67-S04 — Intent-first installed console

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W67-S02, W67-S03
- **Outcome:** The installed console starts from code plus intent, shows a short
  prepared preview, and confirms before write-capable execution.
- **Primary modules:** web, control-plane client, browser fixtures
- **Primary user-story surfaces:** installed onboarding and Mission intake

### Local tasks

1. **Replace topology-first setup.**
   - Purpose: Make code selection the only project prerequisite.
   - Changes: Add local folder, native picker, and Git URL source controls.
   - Validation: Browser scenarios connect both source kinds and show job failures.
2. **Add plain-language task preparation.**
   - Purpose: Remove mandatory Mission-schema authoring from first use.
   - Changes: Add intent textarea, bounded attachments, and Prepare task action.
   - Validation: Text-only and text-plus-file scenarios persist submissions.
3. **Render preparation and recovery states.**
   - Purpose: Keep AI interpretation reviewable before execution.
   - Changes: Add preview revision, provider blocker, confirmation, and retry-start states.
   - Validation: Editing creates a revision and failed start retains one Flow.
4. **Demote advanced configuration.**
   - Purpose: Keep inferred topology and provider detail available without blocking ingress.
   - Changes: Move topology, routes, providers, and storage into Project settings.
   - Validation: Advanced settings remain accessible after onboarding.

### Acceptance criteria

1. The primary path needs only a code source and text or a file.
2. The preview exposes outcome, acceptance, scope, safety, and provider.
3. Analyze work defaults to no-write and change work to patch-only.
4. A failed start preserves one durable confirmed task.

### Done evidence

- Component and browser tests
- Accessibility and installed-package scenarios

### Out of scope

- Visual redesign outside the ingress surfaces

## W67-S05 — Explicit materialization, export, and closure proof

- **State:** blocked
- **Epic:** EPIC-0, EPIC-5, EPIC-6, EPIC-7
- **Hard dependencies:** W67-S04
- **Outcome:** Operators explicitly materialize portable configuration or a
  selected evidence closure without exporting runtime internals or mutating Git.
- **Primary modules:** core, CLI, API, web, docs, installed proof
- **Primary user-story surfaces:** repository owner, delivery, audit

### Local tasks

1. **Materialize portable configuration.**
   - Purpose: Let operators explicitly keep reusable AOR project configuration with code.
   - Changes: Sanitize and atomically write only `.aor/project.yaml`.
   - Validation: Absolute paths, credentials, and readiness state are absent.
2. **Export selected evidence.**
   - Purpose: Produce a bounded review closure without copying the runtime.
   - Changes: Copy selected logical refs and write a digest manifest atomically.
   - Validation: Selection, digest, forbidden-category, and collision tests pass.
3. **Expose write-back safety.**
   - Purpose: Make repository effects and ignore rules visible before action.
   - Changes: Add Git-ignore warnings and preserve no-add/no-commit/no-push behavior.
   - Validation: Git index and upstream state remain unchanged.
4. **Prove installed closure.**
   - Purpose: Verify headless and web parity in the packaged product.
   - Changes: Update docs, API/OpenAPI, catalog, browser fixtures, and package smoke.
   - Validation: Focused, root, browser, installed-package, and slice gates pass.

### Acceptance criteria

1. Materialization contains no absolute paths, credentials, or readiness state.
2. Export includes only selected refs and a validating manifest.
3. No action stages, commits, or pushes Git changes.
4. README, runbooks, API/OpenAPI, CLI catalog, and examples match runtime.

### Done evidence

- Export/materialization tests
- Installed browser proof
- `pnpm slice:gate -- W67-S05`

### Out of scope

- Automatic commits, PRs, or complete runtime export
