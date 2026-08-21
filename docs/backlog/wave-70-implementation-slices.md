# Wave 70 implementation slices — Task Workspace console

## Purpose

Replace the internal-object-first console presentation with the Task Workspace
target in `docs/product/08-task-workspace-console-design.md`. W70 begins after
W69 closure, remains headless-first, and preserves runtime-owned actions,
evidence, safety, and completed-history immutability. Development acceptance is
deterministic and local-browser only; it does not claim provider qualification.

## W70-S01 — Task Workspace product, screen, and migration baseline

- **State:** done
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

- **State:** done
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

- **State:** done
- **Epic:** EPIC-1, EPIC-6
- **Hard dependencies:** W70-S09
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

## W70-S09 — Task Workspace deterministic browser proof harness baseline

- **State:** done
- **Epic:** EPIC-0, EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W70-S02
- **Outcome:** The private installed browser-proof harness can express and
  fail-closed validate the complete Task-first journey before product screen
  slices add their scenario evidence.
- **Primary modules:** `scripts/live-e2e/**`, installed-browser-proof contract,
  guided journey profiles, browser scenario collector, proof tests and runbooks
- **Primary user-story surfaces:** PBO-09, PBO-10, OPS-01, OPS-04,
  OPS-06, OPS-07, OPS-11, OPS-12

**Purpose:** Make the private installed-user proof harness capable of proving
the Task-first journey before W70 screen implementation depends on obsolete
Flow/Cockpit selectors or weak proxy assertions.

**Changes:** Introduce a versioned Task Workspace browser-proof scenario model
for `Project -> Task -> Prepare -> Start -> Work -> Review -> Complete`; split
the monolithic collector into screen/action scenario packs; require real UI
interaction plus durable public-route readback; preserve historical v2 proof
hydration while preventing v2 evidence from satisfying W70 acceptance.

### Local tasks

1. **Define the Task Workspace proof contract.**
   - Purpose: make the eight screens, critical transitions, state branches, and
     evidence requirements fail closed.
   - Changes: add a versioned private proof contract, canonical scenario IDs,
     screen/action identities, compatibility rules, and positive/negative
     fixtures.
   - Validation: contract tests reject missing screens, synthetic pass cells,
     stale identities, missing UI actions, and missing durable readback.
2. **Build a screen-aware scenario collector.**
   - Purpose: replace the old selected-Flow/Cockpit-specific browser probe with
     reusable Task Workspace journeys.
   - Changes: add semantic screen/action drivers for onboarding, Tasks Home,
     preparation, active work, Attention, review, completion, recovery,
     accessibility, and viewports; reserve direct API use for fixture setup and
     durable readback rather than substituting for claimed UI interaction.
   - Validation: collector tests no longer require `Continue Flow`,
     `.flow-cockpit`, or `Ask AOR for selected flow`, and fail when a required
     visible interaction is skipped.
3. **Separate deterministic breadth from release-provider depth.**
   - Purpose: cover all negative and responsive branches without invoking paid
     providers.
   - Changes: add deterministic browser scenario packs for text, uploaded and
     repository Markdown, stale sources, unavailable runner, Attention,
     failure, review, completion, reload, offline, and accessibility; record
     the future release-provider follow-up without a catalog-backed run.
   - Validation: fixture server and proof-runner tests show deterministic branch
     coverage without provider execution or upstream writes.
4. **Map incremental ownership and cutover.**
   - Purpose: let W70-S03 through W70-S07 add their scenarios while W70-S08
     remains the final installed acceptance run.
   - Changes: update live E2E runbooks, scenario coverage matrix, profile
     guidance, and the retirement rule for historical v2 selectors/evidence.
   - Validation: reference checks and slice plans expose an explicit owner for
     every W70 screen, action, state, and closure artifact.

### Acceptance criteria

1. The current proof schema fails closed unless all eight Task Workspace
   screens and the canonical lifecycle transitions have immutable evidence.
2. A claimed browser action is performed through the installed UI and linked
   to its canonical mutation identity, returned durable ID, evidence refs, and
   post-reload public readback.
3. The active collector has no hard dependency on selected-Flow readiness,
   `.flow-cockpit`, `Continue Flow`, or `Ask AOR for selected flow`.
4. Deterministic scenarios cover the W70 negative/state matrix and canonical
   journey without provider execution or expansion of the qualification matrix.
5. Historical v2 proof remains readable for audit, but cannot satisfy W70
   installed acceptance or silently pass synthetic recovery cells.

### Done evidence

- Versioned private proof contract and compatibility fixtures
- Screen/action scenario coverage matrix
- Collector and proof-runner test output
- Canonical and repair/attention deterministic fixture snapshots
- Updated live E2E runbook and reference-check output

### Out of scope

- Implementing the W70 product screens themselves
- Expanding the required provider qualification matrix
- Paid qualification runs or upstream target-repository writes

## W70-S04 — New Task, Markdown Sources, and Prepared Task

- **State:** done
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

- **State:** done
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

- **State:** done
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

- **State:** done
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

- **State:** done
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
  internal-object vocabulary in the local fixture proof.
2. Text-only, uploaded Markdown, repository Markdown, stale source, unavailable
  runner, attention, review, failure, and completion scenarios have evidence.
3. No runtime state, secrets, generated AOR Home data, or upstream writes enter the commit.

### Done evidence

- Local installed browser artifacts, screenshots, accessibility report, story
  matrix, package smoke, and root gate logs.

### Out of scope

- Hosted multi-user console or organization-wide portfolio orchestration.

## W70-S10 — Task Workspace visual fidelity and review-proof remediation

- **State:** done
- **Epic:** EPIC-0, EPIC-4, EPIC-6, EPIC-7
- **Hard dependencies:** W70-S08
- **Primary modules:** review read contract, Task projection/API, Task Workspace UI, semantic tokens/components, responsive drawer, browser visual proof
- **Primary user-story surfaces:** DEV-06, OPS-01, OPS-12, PBO-09, PBO-10

**Purpose:** Close the evidence-backed gap between the accepted W70 Task
Workspace target and the shipped local-browser implementation without moving
lifecycle ownership into the browser or weakening the no-write boundary.

**Changes:** Add a bounded query-safe Task review read model for real file and
Markdown diffs; replace font glyphs with the shared outline icon system; align
typography, list density, semantic controls, completion layout, and narrow
inspector composition with the W70 target; strengthen same-state visual,
responsive, accessibility, and console proof until no P0-P2 design-QA finding
remains.

### Local tasks

1. **Restore acceptance and traceability truth.**
   - Purpose: make the remediation reviewable without rewriting historical W70 evidence.
   - Changes: register W70-S10 after W70-S08, link the design-QA report, and keep DEV-06, OPS-01, OPS-12, PBO-09, and PBO-10 closure claims scoped to executable proof.
   - Validation: backlog status/plan, story reference, and dependency checks agree.
2. **Define the bounded Task review read contract.**
   - Purpose: let Review Changes show real evidence instead of browser-owned placeholder content.
   - Changes: specify changed-file summaries, selected-file hunks, line numbers, Markdown rendered/source comparison, truncation, sanitization, freshness, and evidence lineage in the control-plane contract and OpenAPI examples.
   - Validation: contract/API tests reject unsafe paths, active content, unbounded payloads, missing lineage, and unknown Tasks or files.
3. **Implement the review projection and web behavior.**
   - Purpose: make approval decisions inspectable from durable server-owned evidence.
   - Changes: build the core/API read projection, client fetch state, selected-file behavior, meaningful diff rows, and Rendered/Source diff tabs with loading, empty, error, binary, and truncated states.
   - Validation: projection, transport, client, component, and browser tests cover real changed content and fail closed.
4. **Align the shared Task Workspace visual system.**
   - Purpose: remove the largest cross-screen fidelity drift without one-off styling.
   - Changes: reuse the shared outline Icon primitive, align the 28/18/14/12 type scale and density tokens, compact task rows, make select-looking controls semantic, and reflow Completion delivery/evidence content.
   - Validation: UI foundation, keyboard, accessible-name, contrast, and target-comparison checks pass.
5. **Complete narrow-layout composition.**
   - Purpose: keep state, safety, and primary actions usable on tablet, mobile, and 200% zoom.
   - Changes: add a visible inspector drawer trigger with focus trap/return and Escape close, preserve compact-navigation labels for assistive technology, and prevent overflow or clipped fixed actions.
   - Validation: tablet, 390x844 mobile, zoom-200, reduced-motion, focus-order, and overflow browser checks pass.
6. **Re-run installed visual acceptance.**
   - Purpose: replace the blocked audit with reproducible acceptance evidence.
   - Changes: match fixture content across all eight 1586x992 target states, retain raw console results, capture focused/mobile evidence, update comparison history, and run the slice and root gates.
   - Validation: design QA reports zero P0/P1/P2 findings; browser proof, package smoke, `pnpm slice:gate`, and `pnpm check` pass.

### Acceptance criteria

1. Review Changes renders a bounded server-owned diff with selected-file,
   source/rendered, loading, empty, error, binary, and truncated states; the
   browser contains no hard-coded approval evidence.
2. The eight desktop screens match the W70 visual hierarchy and density with
   one outline icon system, semantic controls, and no visible text-glyph assets.
3. Tablet, mobile, keyboard-only, 200% zoom, reduced motion, and inspector
   drawer behavior preserve state, safety, and the primary action without
   overflow, clipped content, or inaccessible icon-only navigation.
4. Same-state visual evidence, contrast checks, and retained raw console output
   leave no unresolved P0, P1, or P2 design-QA findings.
5. Product, contracts, OpenAPI, examples, Task projections, API/web behavior,
   browser proof, story coverage, and backlog state agree without changing the
   W66 provider-qualification hold.

### Done evidence

- Updated Task review API/OpenAPI examples and contract/projection tests
- Task Workspace component, accessibility, responsive, and browser tests
- Eight same-state desktop comparisons plus tablet/mobile/zoom evidence
- `design-qa.md` comparison history with final result `passed`
- Story/reference checks, package smoke, `pnpm slice:gate`, and `pnpm check`

### Out of scope

- New Task lifecycle ownership, provider execution, hosted multi-user UI, a new
  web framework, or a new component-library dependency.
