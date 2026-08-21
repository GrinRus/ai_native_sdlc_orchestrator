# Task Workspace design QA

Date: 2026-08-21
Scope: W70 Task Workspace, eight target states
Result: `passed`

The W70-S10 remediation closes every P1/P2 finding from the 2026-08-20 comparison pass. No P0, P1, or P2 findings remain in the reviewed implementation. Remaining opportunities are non-blocking P3 polish.

## Evidence

- Visual source of truth: `docs/product/assets/w70-task-workspace-console/01-tasks-home.png` through `08-task-complete.png`
- Product contract: `docs/product/08-task-workspace-console-design.md`
- UI implementation: `apps/web/src/task-workspace.jsx`, `apps/web/src/task-workspace.css`, and `apps/web/src/ui/icon.jsx`
- Review contract and example: `docs/contracts/task-review.md` and `examples/tasks/task-review.sample.yaml`
- Browser closure: `apps/web/browser/task-workspace-closure.spec.mjs`
- Reproducible live fixture: `apps/web/browser/live-ui-fixture.mjs` (same-origin API/read model with real selected-file patch evidence)
- Current-run live screenshots: `.aor/audits/w70-s10-live/01-tasks-home.png` through `08-attention.png`, plus `06-review-rendered.png`
- Desktop live inspection: 1586 × 992, all eight states reached through the UI, no document overflow, source and rendered review evidence visually inspected against the eight target references
- Tablet live inspection: 768 × 1024, Review layout and inspector trigger visible, no document overflow (`12-tablet-review.png`)
- Mobile live inspection: 390 × 844, wrapped long task title, no document overflow, mobile Review/Completion inspector triggers visible, drawer opens with focus on close and Escape returns focus to the opener (`09-mobile-completion.png`, `10-mobile-completion-drawer.png`, `11-mobile-review.png`)
- Narrow-layout stress: 793 × 496 CSS viewport (equivalent available CSS area for a 200% desktop zoom check), no document overflow (`13-zoom-equivalent-review.png`). The in-app browser does not expose a browser-level zoom control, so this is recorded as an equivalent stress check rather than an exact browser zoom measurement.
- Live accessibility spot-check: 22 buttons on Review, zero unnamed buttons; `document.documentElement.scrollWidth === window.innerWidth` at desktop, tablet, mobile, and narrow-layout widths
- Installed browser suite: 20 expected, 0 unexpected, 0 flaky
- Focused web, API, and projection tests: passed
- Production web build: passed

The browser proof exercises plain-text and Markdown preparation, repository sources, unavailable runners, attention/failure recovery, actual selected-file diff rows, Rendered/Source diff switching, immutable completion, follow-up creation, keyboard focus, reduced motion, offline recovery, and the 390 × 844 breakpoint. The live pass additionally verified that changing screens resets scroll to the top and that long diff rows wrap without before/after overlap.

## Closed findings

### Icon consistency — closed

Font-dependent Unicode assets were replaced with one shared outline SVG icon component. Icon-only navigation and controls retain explicit accessible names.

### Review evidence — closed

Review now loads the bounded read-only `GET /api/projects/:projectId/tasks/:taskId/review` projection. The UI renders selected-file additions, deletions, line numbers, Markdown before/after excerpts, and explicit loading, empty, unavailable, binary, truncated, and error states. It no longer fabricates identical Before/After content.

### Responsive inspector access — closed

Review, active Task, and completion inspectors remain inline on desktop and move to a visible, focus-trapped drawer below 900 px. Escape close and opener focus return come from the shared Dialog contract.

### Typography and density — closed

Page headings are capped at the documented 28 px scale, Task titles no longer reach 48 px, list group/row heights were reduced, and routine secondary lifecycle copy was removed from rows.

### Review layout stability — closed

Diff columns now keep independent minimum widths and wrap long source lines instead of allowing before/after content to overlap. Screen transitions reset the document scroll position so Completion opens at its top-level summary.

### Control semantics — closed

Repository, branch, runner, model/effort, and safety choices are native labelled controls. Model and reasoning are intentionally presented as one compact `Model / effort` decision row.

### Completion handoff — closed

Delivery metadata is vertically separated, long digests wrap, evidence remains left-scannable, and shared icons replace text glyphs.

## Residual P3 polish

- Add a dedicated same-content 390 × 844 visual reference set; current target images are desktop-only.
- Tune minor one-pixel border/radius and icon-gap differences after the next reference refresh.
- Add an automated numeric contrast report to complement the existing semantic-token and focus-state checks.

## History

- Iteration 1 — 2026-08-20: blocked, 0 P0 / 3 P1 / 4 P2.
- Iteration 2 — 2026-08-21: passed, 0 P0 / 0 P1 / 0 P2; P3 polish only.
