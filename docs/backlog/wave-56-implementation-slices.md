# W56 implementation slices

W56 turns the latest local app UX gap analysis into installed-user console
hardening slices. It does not change AOR contracts, CLI/API behavior, runtime
orchestration, delivery modes, or live E2E acceptance policy.

## W56-S01 — First-run console focus and action clarity

- **Outcome:** The local AOR console keeps the first-run path focused on the
  next safe action while preserving advanced evidence surfaces through
  progressive disclosure.
- **Epic:** EPIC-1, EPIC-6
- **State:** done
- **Primary modules:** `apps/web/**`, `docs/backlog/**`, `README.md`, tests
- **Hard dependencies:** W55-S05
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks
1. Add first-run focus mode for clean launch, initialized-without-flow, and
   draft-flow states so empty advanced evidence panels do not compete with the
   primary path.
2. Clarify CTA copy for first-flow setup, mission submission, and active-flow
   success state.
3. Add visible disabled/recovery reasons for flow-dependent actions and
   unavailable template options.
4. Compact mobile first-run layout so the project, status, stage progress, and
   primary action remain scannable without horizontal overflow.
5. Update web smoke tests and run focused build/smoke checks.

### Acceptance criteria
1. A clean first-run screen presents one primary initialization action and does
   not show empty execution, graph, trace, interaction, or decision panels as
   first-class content.
2. The initialized-without-flow screen uses `Configure First Flow`, and the
   draft mission submit action uses `Create Flow & Resolve Next Action`.
3. Disabled `Ask AOR`, completed-flow, cross-flow, and unavailable template
   actions explain the required recovery condition.
4. At mobile width, the first-run top bar and stage progress stay within the
   viewport and keep the primary action reachable in the first screen.
5. Active-flow handoff still shows one recommended action, no-write safety,
   flow id, evidence count, and enabled flow-scoped Ask AOR.

### Done evidence
- updated web source and focused web tests
- `node --test apps/web/test/operator-console.test.mjs`
- `node --test apps/web/test/operator-request-spa.test.mjs`
- `pnpm web:build`
- `pnpm aor app --project-ref <repo> --runtime-root <temp> --smoke --open false --json`

### Out of scope
- Changing contracts, public CLI/API payloads, runtime command behavior, or
  packet schemas.
- Broad visual redesign beyond first-run focus, progressive disclosure, copy,
  and mobile scannability.
- Committing `.aor/` runtime evidence.

## W56-S02 — Rendered cockpit UX hardening

- **Outcome:** The local AOR console keeps the active-flow cockpit primary on
  desktop, tablet, and mobile while first-run support surfaces remain behind
  progressive disclosure.
- **Epic:** EPIC-1, EPIC-6
- **State:** done
- **Primary modules:** `apps/web/**`, `docs/backlog/**`, tests
- **Hard dependencies:** W56-S01
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks
1. Keep clean first-run, initialized-without-flow, and draft-flow screens
   focused on the wizard by moving rail, activity, artifacts, and inventory
   support surfaces behind collapsed disclosure.
2. Make active-flow cockpit task-first on desktop, tablet, and mobile so the
   selected project, flow, safety status, and one recommended action appear
   before long evidence surfaces.
3. Group flow-scoped Evidence/Documents, Execution Evidence, Evidence Graph,
   Runtime Trace, Interactions Inbox, and Operator Decision surfaces into one
   advanced workbench with tabs/disclosure.
4. Add a minimal semantic CSS-token pass for touched shell, controls, focus,
   and responsive states, including mobile-sized touch targets.
5. Update focused web tests and run build, smoke, and rendered browser checks
   on a clean temp target.

### Acceptance criteria
1. At `390x844` and `768x1024`, the active-flow top bar and stage rail do not
   push the main cockpit below the first viewport, and `Resolve Next Action`
   is reachable without a long scroll.
2. First-run focus mode does not render right rail, activity tables, artifact
   tables, flow inventory, execution evidence, graph, trace, interaction, or
   decision panels as first-class content.
3. Long `project-ref` and `runtime-root` values render as short path chips with
   full values available through title/details/copy affordances.
4. Flow-scoped advanced surfaces are grouped in one advanced workbench and do
   not render as multiple long inline sections by default.
5. Desktop controls keep at least a 38px target and mobile touch controls keep
   at least a 44px target while preserving visible focus states.

### Done evidence
- updated web source and focused web tests
- `node --test apps/web/test/operator-console.test.mjs`
- `node --test apps/web/test/operator-request-spa.test.mjs`
- `pnpm web:build`
- `pnpm aor app --project-ref <temp-target> --runtime-root <temp-target>/.aor --smoke --open false --json`
- rendered browser check at `1440x900`, `390x844`, and `768x1024`

### Out of scope
- Changing contracts, public CLI/API payloads, runtime command behavior, or
  packet schemas.
- Changing orchestration ownership or making `apps/web` responsible for
  critical runtime logic.
- Committing `.aor/` runtime evidence, temp targets, screenshots, or ad hoc
  audit notes.

## W56-S03 — Rendered UX audit closure

- **Outcome:** The local AOR console closes the P1/P2 findings from the
  rendered UX/UI audit while preserving the W56 flow-first cockpit and
  docs-first runtime boundaries.
- **Epic:** EPIC-1, EPIC-6
- **State:** done
- **Primary modules:** `apps/web/**`, `docs/backlog/**`, tests
- **Hard dependencies:** W56-S02
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-10, OPS-11.

### Local tasks
1. Add compact first-run shell rules for mobile and tablet so secondary topbar
   controls do not push the first-run wizard below the first viewport.
2. Gate Operator Decision actions on real pending `agent_decision_request_ref`
   evidence instead of deriving actionable requests from generic artifacts.
3. Render long runtime paths and lifecycle commands as compact primary labels
   with full values available through title, copy, or debug details.
4. Restore focus to the Ask AOR opener after the request drawer closes and keep
   no-write request behavior unchanged.
5. Make `delivery-mode=no-write` explicit in the safe walkthrough summary and
   place the advanced workbench before support activity tables on active flows.
6. Tokenize only the touched topbar, activity, drawer, decision, and workbench
   styles.

### Acceptance criteria
1. Clean first-run topbar height is at most `180px` at `390x844` and at most
   `220px` at `768x1024`; there is no horizontal overflow and
   `Initialize Project Runtime` remains visible in the first viewport.
2. An active first flow with no pending decision shows Operator Decision count
   `0`, no action buttons, no fake `ready` pill, and the empty copy
   "No pending agent decision request for this flow."
3. First-run and active cockpit ordinary visible text does not expose full
   `/var/folders/...` paths or full `aor mission create --project-ref ...
   --runtime-root ...` commands as primary table/card text.
4. Closing Ask AOR through Escape, close button, or successful submit returns
   focus to the opener or the nearest still-mounted Ask AOR trigger.
5. The safe walkthrough draft renders literal `delivery-mode=no-write`.
6. At `1440x900`, the advanced workbench is reached before Activity / Events
   support tables after the cockpit; at `390x844` and `768x1024`, it remains
   collapsed and does not push `Resolve Next Action` out of the first viewport.
7. New or changed CSS in touched blocks uses semantic variables for colors,
   borders, radii, and control heights, with no new raw hex values outside
   token declarations.

### Done evidence
- updated web source and focused web tests
- `node --test apps/web/test/operator-console.test.mjs`
- `node --test apps/web/test/operator-request-spa.test.mjs`
- `pnpm web:build`
- `pnpm aor app --project-ref <temp-target> --runtime-root <temp-target>/.aor --smoke --open false --json`
- rendered browser check at `1440x900`, `390x844`, and `768x1024`

### Out of scope
- Changing contracts, public CLI/API payloads, runtime command behavior, or
  packet schemas.
- Faking completed-flow or operator-decision runtime states that are not present
  in available evidence.
- Broad visual redesign or full-file design-system cleanup.
- Committing `.aor/` runtime evidence, temp targets, screenshots, or ad hoc
  audit notes.

## 2026-07-09 live E2E UX audit addendum

This addendum records the first iterative UX/UI pass after W56 closure. The
pass used HTTPX medium live E2E runs and rendered browser checks to inspect the
operator console as a first-time user would see it when the run stops for a
human gate or a real environment failure.

### Evidence reviewed

- `live-e2e.full-journey.regress.httpx.medium.openai.ux-rerun-1e655bd`
  stopped at the Discovery controller decision gate.
- `live-e2e.full-journey.regress.httpx.medium.openai.ux-rerun-8a8354e`
  stopped at the Discovery product-change step-quality assessment gate.
- `live-e2e.full-journey.regress.httpx.medium.openai.ux-rerun-d0e97bd`
  reached an Execution target setup failure with
  `failure_owner=environment`, `failure_phase=target_setup`, and
  `failure_class=environment_disk_space_exhausted`.
- `live-e2e.full-journey.regress.httpx.medium.openai.ux-rerun-2648ca0`
  was rerun after temp-workspace cleanup. Target readiness returned to `pass`,
  the Discovery controller decision was accepted with `continue`, and the run
  then stopped at the Discovery step-quality assessment gate as expected.
- Rendered desktop and mobile checks covered the generic decision gate, the
  step-quality assessment gate, and the real target setup blocker screen.

### UX quality report

| Surface | Finding | Remediation |
|---|---|---|
| Discovery controller decision gate | Generic pending decisions looked too similar to failures because the UI reused blocker language. | The cockpit, risk label, flow inventory, and external run panel now use decision-specific copy and avoid `Blocked` for a generic pending controller decision. |
| Step-quality assessment gate | The assessment pause looked like an operator decision or blocker even though the required action is evaluator assessment. | The gate now uses assessment-specific labels, workbench copy, status chips, and test coverage. |
| Execution target setup failure | The main cockpit correctly explained the environment-owned blocker, but the topbar action still said `Decision needed`. | The topbar now says `Review blocker` for substantive run failures while preserving `Decision needed` and `Assessment needed` for their separate gates. |
| Run-gate primary action | The cockpit's primary action still refreshed the run even when a first-time user needed to open a pending decision or assessment workbench. | Blocking run-health now promotes the matching workbench action (`Decision Request`, `Assessment Evidence`, or `Review Blocker`) as the primary CTA and keeps refresh secondary. The generic Discovery decision now defaults to `Continue` when deterministic evidence is pass. |
| Initial project snapshot loading | On a fresh page load with an active live run, the console could briefly show `Configure First Flow` before the project snapshot resolved. | The initial snapshot state now uses a non-actionable `Syncing project state` card, disables flow actions, and reveals first-flow or active-run CTAs as soon as the base snapshot is loaded, without waiting for heavier advanced evidence hydration. |
| Provider completion handoff | After provider execution completed but before the controller wrote the next gate, the cockpit could fall back to stale accepted-decision evidence from the previous step. | Terminal provider status now keeps the run-status focus only for synthetic `continue` blockers without a materialized decision request; once run-health exposes `request_ref` or `expected_decision_ref`, the decision request becomes primary. |
| Review blocker decision CTA | A review-stage target verification blocker still required an operator diagnosis, but the primary button said `Review Blocker` while the copy told the user to open a decision request. | Substantive blockers with a materialized decision request now keep `Decision Request` as the primary workbench CTA; generic blocker evidence remains `Review Blocker` when no decision file exists. |
| Accepted diagnosis CTA | After the operator diagnosis was accepted, the repair-required state still showed `Decision Request` as the primary button because the original request ref stayed in run-health. | Accepted non-continue decisions now count as materialized but closed; the cockpit keeps the repair/blocker path primary instead of asking the user to repeat an accepted decision. |
| Repair recovery CTA | A request-repair or retry state could still look like a generic `Review Blocker`, forcing first-time users to infer the next step from lower-panel recovery copy. | Closed repair-required blockers now use `Recovery needed`, `Recovery Path`, `Recovery checks`, and `<step> repair required` across the topbar, cockpit, stage rail, right rail, and status chips while open decision requests still stay primary. |
| Recovery tab public command | The `Recovery Path` CTA opened Execution Evidence, but that tab still showed generic `Diagnose current step` guidance instead of the public repair command from run-health. | Execution Evidence now receives run-health, promotes `pending_decision.public_repair_command` as `Run public repair command`, adds project/run context flags, and keeps generic diagnose/retry controls only when no repair command is available. |
| Post-request repair next action | After running the public `aor review decide --decision request-repair` command, `/next-action-report` correctly selected `run-review-quality-repair`, but the cockpit, right rail, and Execution Evidence panel still prioritized stale blocked run-health diagnosis copy. Failed verification also held the repair command even though that failure was the repair input. | Materialized quality-repair next actions now take precedence over run-health diagnosis copy and generic verification holds, so the visible single step and recovery path promote the `aor run start ...repair` command while failed verification remains visible as evidence to fix. |
| Completed repair run loop | After the follow-up `aor run start ...repair` completed, the stale next-action report still offered the same repair run command. A first-time user could rerun repair instead of moving to post-run verification. | The cockpit, right rail, stage rail, and Execution Evidence now detect a matching completed `.repair` run from the public runs list and replace the stale repair command with completed repair status guidance and a safe `aor run status --json --run-id <repair>` command. |
| Failed verification after repair | After the completed repair run, a manual `post-run-primary` verification produced a failed required command group, but the main UI still said "Repair run completed. Continue with post-run verification" and did not surface the failed step-result refs as the next repair input. | Failed required verification now overrides completed-repair guidance, and the verification read model exposes failed command count, failed step-result refs, and blocked next step so the cockpit, right rail, and verification banner can guide the next repair loop. |
| Stale repair command from `aor next` | Refreshing the durable next-action report after the failed post-repair verification still selected `run-review-quality-repair` for an already completed `.repair` run because the resolver only read the stale repair-request status. | `next-action-report` now derives `quality_repair.flow_state` from public sibling run-control evidence as well as the repair request, so a completed `<run>.repair` state returns the flow to `review-quality-repair` and includes the repair run state as evidence instead of reissuing the completed repair command. |
| Quality gate next-action conflict | After fixing `aor next`, the rendered Active Quality Gate still showed `NEXT SAFE ACTION: aor review run` while the main cockpit and alert said required verification failed. | Active Quality Gate now receives the same verification failure override as the cockpit; recovery path, status pill, and next-action copy all prioritize repairing failed verification before post-repair review, QA, or delivery. |
| Zero-attempt repair copy | In the same failed verification state, Active Quality Gate still showed `1/1 (0 remaining)` beside "Repair attempt budget is still bounded" and "Review rerun required after repair." | Source-stage and attempt-budget helper copy now explain that required verification must pass before review rerun and that no automatic repair attempts remain, so the user does not infer that immediate review or another automatic repair is available. |
| Completed provider copy after failed verification | The first desktop viewport still showed "Provider CLI session completed" with "Continue with verification, review, or the next quality gate" while the current required verification had failed. | Provider heartbeat and command detail copy now receive the failed-verification override in the cockpit, so a completed provider run tells the operator to repair failed verification before review, QA, delivery, or release. |
| Exhausted repair workbench action | Recovery Path still showed `NEXT PUBLIC CONTROL` as a verification rerun even when Active Quality Gate showed `1/1 (0 remaining)`, leaving a first-time operator without the public repair-request path. | Execution recovery now receives the active quality gate and, when failed verification has exhausted automatic attempts, shows `aor review decide --decision request-repair --repair-context-file <repair-context.json>` as the explicit operator path with the verification rerun described as the post-repair unlock check. |
| Failed verification evidence path | Recovery Path showed the full local `/var/folders/.../step-result-post-run-primary-5.json` evidence path as primary card text, making the repair instruction hard to scan on desktop and mobile. | Execution recovery now keeps human-readable evidence guidance as the primary copy and renders the raw failed step-result ref through compact path disclosure, preserving traceability without letting machine-local paths dominate the operator view. |
| Verification status grid conflict | Execution Evidence explained that post-run verification failed, but the Run health grid still showed `Post-run verification: not_run`, creating contradictory recovery state in the same panel. | The execution status grid now receives the verification read model and overrides the post-run verification row to `failed` whenever the latest required verification group failed. |
| Mobile recovery CTA priority | On the failed-verification mobile viewport, the first visible action was an unlabeled topbar icon and the primary `Recovery Path` button appeared below the full provider heartbeat card. | The active-flow cockpit now renders `One Recommended Action` and its recovery CTA before provider heartbeat telemetry, keeping the public recovery path reachable before detailed provider diagnostics on mobile and desktop. |
| Provider raw evidence status summary | Execution Evidence said `Provider raw evidence 4 readable refs` while each provider evidence chip was `missing`, making unreadable evidence look healthy. | Provider evidence now summarizes readable, missing, and unreadable refs separately, and missing/unreadable chips avoid duplicating the status in the label text. |
| Run-health-only execution debug payload | Opening Execution Evidence from the failed-verification recovery path could log a `run_id` null-read error when the panel was backed by run-health without a separate execution evidence payload. | The debug payload now uses optional execution evidence fields with run-health fallbacks, so the operator recovery panel renders without console errors. |
| Cockpit heading status duplication | The failed-verification cockpit heading rendered as `Post-run verification failed failed` because the heading already contained the failure state and the adjacent status pill repeated it. | Cockpit headings now suppress the adjacent status pill when the title already ends with the same status, keeping the first recovery screen readable without removing useful status pills elsewhere. |
| Accepted diagnosis recovery check | In the failed-verification repair state, `Recovery checks` still showed `Skill-agent requested diagnosis...` even though the diagnosis had already moved the review step into public repair. | Diagnose decisions that carry `request_repair` step-quality evidence now render as a completed transition into repair, so the checks list no longer competes with the active `Recovery Path` action. |
| Public repair decision tab | The failed-verification repair state required an explicit `aor review decide --decision request-repair` command, but the advanced workbench still showed `Operator Decision 0`, making the required public decision look absent. | The workbench now derives the same public repair decision as the cockpit, labels the tab `Repair Decision needed`, and replaces the empty drawer with the repair command, reason, and post-repair verification check. |
| Quality closure assessment prompt | In the same failed-verification repair state, the Evidence / Documents quality-closure card still emphasized `Assessment evidence missing`, even though assessment is not the next safe action until repair and verification pass. | Quality closure now receives the public repair decision context, labels the closure path as blocked by repair, and holds assessment copy until the repair decision plus required verification are complete. |
| Stage and filter selected semantics | The stage rail and artifact filter bar conveyed current and selected state only through visual classes, so keyboard and assistive-tech users could lose the active lifecycle stage or filter context. | Stage buttons now expose `aria-current="step"` for the current lifecycle stage, `aria-pressed` for the selected stage view, and artifact filters expose `aria-pressed` for the active filter. |
| Mobile recovery focus order | In the failed-verification recovery state, mobile layout visually promoted `Recovery Path` before technical details, but keyboard focus still reached `Show CLI command` and `Details` disclosures first. | The active cockpit now renders primary actions before detail disclosures in DOM order, keeping keyboard focus aligned with the visible recommended-action hierarchy. |
| Responsive readability | The inspected desktop and mobile states had no horizontal overflow or clipped primary blocker/decision copy. | Keep the current compact recovery labels as the baseline for the next live E2E pass. |

### Follow-up plan

1. Advance the current HTTPX medium live E2E flow past the Discovery
   step-quality assessment gate with evaluator-authored assessment evidence,
   then inspect execution, review/QA, delivery/release, and learning closure
   screens.
2. Inspect diagnose, retry, and public-step recovery surfaces from the same
   first-time-user perspective when a later step produces a substantive
   provider, target, or validation blocker.
3. Add or verify non-happy-path rendered coverage for rejected operator
   decisions, missing assessment evidence, failed required verification groups,
   repair-request loops, completed-flow read-only state, and follow-up flow
   creation.
4. Keep future UI changes scoped to `apps/web/**`, product/backlog source docs,
   tests, and packaged dist unless a finding proves a contract or control-plane
   read-model gap.
