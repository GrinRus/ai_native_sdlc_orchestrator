# Wave 70 implementation slices — Task Workspace console

## Purpose

Replace the internal-object-first console presentation with the Task Workspace
target in `docs/product/08-task-workspace-console-design.md`. W70 begins after
W69 closure, remains headless-first, and preserves runtime-owned actions,
evidence, safety, and completed-history immutability.

## W70-S01 — Task Workspace product, screen, and migration baseline

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-6
- **Hard dependencies:** W69-S07
- **Primary modules:** product design, screen assets, migration map, story matrix

**Purpose:** Establish one approved information architecture, vocabulary,
screen set, and migration boundary before implementation.

**Changes:** Adopt Task as the primary UI object; define the eight-screen
journey, Markdown behavior, state matrix, component anatomy, and mapping from
Quiet Cockpit surfaces to Task Workspace; retire obsolete screenshot assets.

### Local tasks

1. **Freeze the target journey.**
   - Purpose: stop visual redesign drift.
   - Changes: approve screen inventory, terminology, primary actions, and state ownership.
   - Validation: product/architecture review against headless invariants.
2. **Freeze the visual contract.**
   - Purpose: give implementation an exact target.
   - Changes: maintain the W70 reference images, layout rules, responsive composition, and component inventory.
   - Validation: craft and accessibility checklist review.
3. **Map migration and stories.**
   - Purpose: preserve supported outcomes.
   - Changes: map Cockpit/Attention/Journey/Evidence and PBO-09/PBO-10/OPS-01/OPS-11/OPS-12 to Task Workspace destinations.
   - Validation: reference and story checks.

### Acceptance criteria

1. One normative product document owns UI vocabulary and screen behavior.
2. Every target image has a named screen, primary action, and state contract.
3. Historical runtime semantics remain documented without historical images.

### Done evidence

- W70 design doc, target PNG set, migration table, and story traceability diff.

### Out of scope

- Runtime or web implementation.

## W70-S02 — Task runner override and Markdown source contracts

- **State:** blocked
- **Epic:** EPIC-0, EPIC-1, EPIC-2, EPIC-3, EPIC-6
- **Hard dependencies:** W70-S01
- **Primary modules:** intent submission/normalization, execution profile, Flow projection, control-plane API/OpenAPI, examples, validators

**Purpose:** Give the UI truthful task-scoped runner selection and safe
Markdown uploads/repository references without inventing browser-owned state.

**Changes:** Define additive source items for immutable uploads and pinned
repository Markdown refs; stale/digest behavior; sanitized metadata reads; a
project-default versus task-override route request; readiness and confirmation
CAS; backward-compatible attachment and route-default behavior.

### Local tasks

1. **Specify Markdown sources.**
   - Purpose: distinguish upload snapshots from repository refs.
   - Changes: schema, limits, digest/base identity, stale status, sanitization, examples.
   - Validation: contract/reference/security tests.
2. **Specify task runner override.**
   - Purpose: make Runner selection truthful.
   - Changes: approved option projection, selected route ref, readiness revision, confirmation guard, fallback semantics.
   - Validation: provider-neutral contract and compatibility tests.
3. **Align transports and CLI.**
   - Purpose: preserve headless parity.
   - Changes: OpenAPI/API/CLI requests, responses, errors, and readback.
   - Validation: route drift, CLI/API parity, secret/path canary tests.

### Acceptance criteria

1. Upload bodies and client paths never appear in query surfaces.
2. Repository Markdown refs are project-relative, revision/digest pinned, and
  cannot be confirmed stale without an explicit supported decision.
3. Task runner selection submits a canonical approved route ID; provider/model
  strings never bypass route policy.
4. Legacy uploads and project-default routes remain compatible.

### Done evidence

- Contracts, examples, loader tests, OpenAPI drift output, and CLI/API fixtures.

### Out of scope

- Markdown editing as a general IDE or arbitrary binary attachments.

## W70-S03 — Task shell, Home, and resumable task list

- **State:** blocked
- **Epic:** EPIC-1, EPIC-6
- **Hard dependencies:** W70-S02
- **Primary modules:** web routing/shell, task projections, control-plane client, list components, browser tests

**Purpose:** Make Tasks the default project home and keep drafts, attention,
active, and completed work findable without implicit Flow selection.

**Changes:** Build persistent navigation, searchable/filterable task list,
stable task selection/URL restoration, counts, freshness, empty/loading/offline
states, and a compact Project destination.

### Local tasks

1. **Extract task-level composition.**
   - Purpose: stop adding to the root SPA.
   - Changes: route surfaces and shared selection state into bounded modules.
   - Validation: source ratchet and navigation parity tests.
2. **Build Tasks Home and list.**
   - Purpose: optimize scanning and resume.
   - Changes: groups/filters/search/keyboard selection and task summaries.
   - Validation: component and browser matrices.
3. **Prove recovery.**
   - Purpose: retain durable context.
   - Changes: reload, reconnect, stale partial read, permission, and no-project states.
   - Validation: installed responsive scenarios.

### Acceptance criteria

1. Root project view is Tasks Home with no lifecycle chrome until a Task opens.
2. Draft, attention, active, and completed tasks are distinguishable without
  color alone and retain exact selection after reload.
3. No new monolithic SPA/CSS hotspot or page-level mobile overflow is introduced.

### Done evidence

- Unit/browser navigation, keyboard, responsive, and recovery output.

### Out of scope

- Cross-project portfolio orchestration.

## W70-S04 — New Task, Markdown Sources, and Prepared Task

- **State:** blocked
- **Epic:** EPIC-1, EPIC-2, EPIC-6
- **Hard dependencies:** W70-S02, W70-S03
- **Primary modules:** task composer, Markdown source picker/preview, prepared review, runner picker, browser tests

**Purpose:** Let a user move from intent and Markdown source material to one
reviewed, runner-ready Task without internal vocabulary.

**Changes:** Implement the New Task composer, drag/drop/picker/repository source
flow, sanitized Markdown preview/source tabs, validation, Prepared Task review,
runner/readiness selection, write-effect summary, dirty/CAS/stale recovery.

### Local tasks

1. **Build source interaction.**
   - Purpose: make Markdown provenance obvious.
   - Changes: upload, repository browse, preview, remove/replace, limits, stale state.
   - Validation: invalid UTF-8/size/path/HTML/network tests.
2. **Build runner-aware composer.**
   - Purpose: expose execution intent early.
   - Changes: repository, runner, safety, readiness, advanced route disclosure.
   - Validation: unavailable/disallowed/auth/model/readiness cases.
3. **Build Prepared Task.**
   - Purpose: confirm exactly what will run.
   - Changes: review/edit/save, acceptance/scope/path/source summaries, CAS and start guard.
   - Validation: stale revision/source/readiness and exactly-once start tests.

### Acceptance criteria

1. A task can be prepared from text, Markdown, or both with one clear action.
2. No active Markdown content or automatic remote fetch executes in preview.
3. Runner, safety, and source freshness are visible and valid before Start.
4. Start creates no duplicate Flow/Run on retry or reload.

### Done evidence

- Component/browser/security fixtures for New Task, sources, Prepared Task, and runner selection.

### Out of scope

- WYSIWYG authoring or live collaborative editing.

## W70-S05 — Active Task Workspace and durable guidance

- **State:** blocked
- **Epic:** EPIC-3, EPIC-4, EPIC-6
- **Hard dependencies:** W70-S04
- **Primary modules:** task workspace, live events, run controls, operator requests, changes/check/evidence tabs

**Purpose:** Supervise active work from one screen without conflating chat,
runtime events, and durable evidence.

**Changes:** Add compact lifecycle, current activity, runner/budget/freshness,
pause/cancel/retry, event feed, Task contract inspector, and a composer that
creates a durable operator request with explicit effect and readback.

### Local tasks

1. **Build workspace projection.**
   - Purpose: orient the operator.
   - Changes: header, status path, activity, facts, tabs, inspector.
   - Validation: state fixture matrix.
2. **Connect controls.**
   - Purpose: keep action ownership truthful.
   - Changes: pause/cancel/retry/answer with pending and durable readback.
   - Validation: exactly-once and partial-failure tests.
3. **Connect guidance.**
   - Purpose: support bounded intervention.
   - Changes: label and submit operator-request scope/safety instead of direct chat.
   - Validation: completed-flow, allowed-path, reload, and secret-safe tests.

### Acceptance criteria

1. Live, stale, paused, interaction, canceling, failed, repair, and completed
  states never reuse an incorrect primary action.
2. Guidance visibly creates a durable AOR request and cannot bypass policy.
3. Activity, changes, checks, and evidence remain usable by keyboard and mobile drawer.

### Done evidence

- Live/reconnect/control/operator-request browser and service tests.

### Out of scope

- Direct unsupervised runner chat.

## W70-S06 — Attention, change review, and completion evidence

- **State:** blocked
- **Epic:** EPIC-4, EPIC-5, EPIC-6
- **Hard dependencies:** W70-S05
- **Primary modules:** attention queue, review/diff, Markdown renderer, delivery/evidence completion, browser tests

**Purpose:** Close human decisions, Markdown/code review, delivery effects, and
task completion without sending the user to disconnected workbenches.

**Changes:** Implement consequence-first Attention detail, durable approvals and
answers, file tree/diff, Markdown rendered before/after plus source diff,
checks/findings, request-revision, delivery preview, completion digest, evidence
lineage, and follow-up Task.

### Local tasks

1. **Build Attention.**
   - Purpose: resolve authoritative human work.
   - Changes: deterministic ordering, independent drafts, evidence, action/readback.
   - Validation: multi-item, permission, partial, resolved-history tests.
2. **Build change review.**
   - Purpose: make document and code changes reviewable.
   - Changes: file list, unified diff, Markdown render/source comparison, checks, accept/revise actions.
   - Validation: sanitization, large diff, binary/empty, keyboard tests.
3. **Build completion.**
   - Purpose: explain outcome and write effects.
   - Changes: verification, manifest, evidence, follow-up lineage.
   - Validation: no-write, patch-only, immutable completed Task, and failed delivery cases.

### Acceptance criteria

1. Every attention action states its consequence and reads back durable evidence.
2. Markdown review never executes active content and always offers source diff.
3. Partial verification or delivery cannot render as completed success.
4. Completed tasks are immutable; follow-up creates a new Task.

### Done evidence

- Attention/review/completion browser, accessibility, security, and lifecycle tests.

### Out of scope

- Browser-owned snooze or drag-to-change lifecycle state.

## W70-S07 — Design-system implementation and legacy UI retirement

- **State:** blocked
- **Epic:** EPIC-0, EPIC-6
- **Hard dependencies:** W70-S06
- **Primary modules:** semantic tokens/components, responsive CSS, legacy web sources/assets, quality ratchets

**Purpose:** Make the target screens one reusable system and remove the old
renderer debt only after behavioral parity exists.

**Changes:** Implement relaxed/compact density, shell/list/inspector/diff/source
components, full interaction states, responsive drawer composition, remove
retired Cockpit presentation branches/styles and obsolete images, and tighten
SPA/CSS size ratchets.

### Local tasks

1. **Complete tokens and components.**
   - Purpose: prevent one-off styling.
   - Changes: semantic roles, density, selected/focus/loading/error/destructive variants.
   - Validation: UI foundation tests and contrast review.
2. **Verify responsive composition.**
   - Purpose: preserve hierarchy across sizes.
   - Changes: desktop/tablet/mobile/zoom/reduced-motion rules.
   - Validation: browser screenshot and overflow matrix.
3. **Retire legacy paths.**
   - Purpose: remove conflicting UI.
   - Changes: delete proven unused source/CSS/assets and lower hotspot ceilings.
   - Validation: bundle, dead-code, reference, and parity gates.

### Acceptance criteria

1. Target screens consume semantic tokens and shared components without raw
  per-screen palettes or duplicate anatomy.
2. No obsolete renderer, screenshot, selector, or CSS branch ships.
3. Supported viewports have no clipped primary action, unsafe overflow, or hidden state.

### Done evidence

- UI foundation, source ratchet, bundle manifest, and visual matrix output.

### Out of scope

- New framework or component-library dependency.

## W70-S08 — Installed Task Workspace proof and story closure

- **State:** blocked
- **Epic:** EPIC-0, EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W70-S07
- **Primary modules:** installed browser scenarios, product/backlog/story docs, runbooks, package proof

**Purpose:** Prove the complete target UX from installed package rather than
accepting screenshots or source markers as completion.

**Changes:** Exercise all eight screens, Markdown and runner branches, safe
lifecycle, attention/review/completion, responsive/accessibility/reload/offline
states; update stories/docs/runbooks; run package and repository gates.

### Local tasks

1. **Run visual and accessibility acceptance.**
   - Purpose: compare implementation to targets.
   - Changes: deterministic fixtures and screenshot matrix.
   - Validation: keyboard, focus, zoom, mobile, reduced-motion, contrast checks.
2. **Run installed lifecycle proof.**
   - Purpose: verify real packaged behavior.
   - Changes: text/Markdown preparation through no-write and patch-only closure.
   - Validation: installed browser journal and unique durable refs.
3. **Close traceability and gates.**
   - Purpose: align claims with evidence.
   - Changes: story matrix, docs, runbooks, backlog state.
   - Validation: `pnpm slice:gate`, browser gate, package smoke, reference checks.

### Acceptance criteria

1. Installed users complete the canonical lifecycle without terminal handoff or
  internal-object vocabulary.
2. Text-only, uploaded Markdown, repository Markdown, stale source, unavailable
  runner, attention, review, failure, and completion scenarios have evidence.
3. No runtime state, secrets, generated AOR Home data, or upstream writes enter the commit.

### Done evidence

- Installed browser artifacts, screenshots, accessibility report, story matrix,
  package smoke, and root gate logs.

### Out of scope

- Hosted multi-user console or organization-wide portfolio orchestration.
