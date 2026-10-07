# Iterative Task prototype design QA

Final result: passed

This result applies to the bounded three-screen fixture and the checks below.
It does not accept the full W72-S17 design, establish runtime correctness,
prove WCAG conformance, or claim improved human comprehension.

Inspection date: 2026-10-01. Browser: Codex in-app Browser. Source baseline:
`fe77035c28802e9e3dcccb42b8ff2a9978744f17` plus the local product UX brief.
All requests, task IDs, decisions, diffs, proof, and timelines are synthetic.

## Design sources

- [Task UX brief](../../10-iterative-task-ux.md).
- [Current renderer evidence](../../assets/w72-iterative-ux-baseline/README.md),
  especially Prepared Task, Attention, and Review.
- [Command Desk tokens](../../../../apps/web/src/ui/tokens.css),
  [components](../../../../apps/web/src/ui/components.jsx), and source icons.

This is an intentional change in information hierarchy, not a pixel clone of
the current alpha. Preserve its navigation, tokens, and component vocabulary;
make behavior, consequential decisions, and criterion proof primary.

## Rendered evidence and normalization

Screenshots use one image pixel per CSS pixel, with observed device pixel ratio
1. The renderer references are 1280 × 720px. The baseline Prepared screenshot
and [prototype Prepared](screenshots/prepared-1280.jpg) were opened together at
the same viewport; Review was inspected against the existing diff-first layout
and the new criterion-first brief. Task content differs deliberately: the
baseline fixture does not contain the new contradiction/proof scenario.

| Viewport | Inspected states and screenshot evidence |
| --- | --- |
| 1440 × 900 | [Prepared](screenshots/01-prepared-1440.jpg), [decision](screenshots/02-decision-1440.jpg), [Review with unknown C03](screenshots/03-review-1440.jpg), [Start authority](screenshots/04-start-authority-1440.jpg) |
| 1280 × 720 | [Prepared](screenshots/prepared-1280.jpg), [decision](screenshots/decision-1280.jpg), [Review](screenshots/review-1280.jpg); full-page/scroll inspection of criteria, sources, and bounds |
| 768 × 1024 | [Prepared](screenshots/prepared-768.jpg), [decision](screenshots/decision-768.jpg), [Review](screenshots/review-768.jpg) |
| 390 × 844 | [Prepared](screenshots/prepared-390.jpg), [decision](screenshots/decision-390.jpg), [Review](screenshots/review-390.jpg), [missing-proof dialog](screenshots/proof-missing-390.jpg) |
| 640 × 360 | [Reflow and keyboard focus](screenshots/review-reflow-640.jpg); this is a narrow viewport proxy, not actual browser zoom |

DOM measurements returned document widths equal to the viewport at 390, 640,
768, 1280, and 1440px. Content uses normal vertical scrolling. Sticky actions
stay available, and the focused proof control in the short 640 × 360 viewport
was measured at y=78–102px, above the action bar at y=279px.

Full-view comparisons checked navigation, major-region proportions, title and
status wrapping, the main/support layout, and primary action visibility.
Focused-region inspection checked the contradiction comparison, C03 Unknown
versus Verified/Stale states, proof bindings, Start bounds, and the mobile
dialog. The [full-page Prepared capture](screenshots/prepared-full-1280.jpg)
contains the viewport-positioned sticky bar; individual viewport/scroll checks
were used to inspect content behind that capture overlay.

## Fidelity surfaces

| Surface | Assessment |
| --- | --- |
| Fonts and typography | Reused the canonical Inter/system font stack and mono stack without external font downloads. Titles are 30px desktop / 24px mobile; behavior and observations are 13–16px; secondary provenance is 11px. Inspected weights, line height, wrapping, and the short status labels. The explicit 30px title is an intentional smaller hierarchy than the current large alpha heading. |
| Spacing and layout | Reused control/card/modal radii and button sizing. A 200px desktop rail, 24px region gap, and two task regions replace persistent three-column review. Tablet uses a compact rail and ordered sections; mobile uses a horizontal navigation and one content column. No observed overlap or horizontal overflow remains in the inspected states. |
| Colors and tokens | Existing dark rail, light canvas, teal actions, and semantic warning/success/information roles are imported directly. Status includes words and icons. Static token contrast for enabled text roles exceeds 4.5:1; disabled controls remain visibly disabled. |
| Image and icon fidelity | No raster imagery is required by these operational screens. The AOR type wordmark and icons reuse existing source primitives; no generated or approximate illustration assets were added. |
| Product copy | Request, AI proposal, effective revision, adoption, Start, verification, and local acceptance are distinct. Negative requirements remain explicit. Missing observation is Unknown despite command exit 0; older revision proof is Stale. Prototype/fixture labels stay visible at every inspected breakpoint. |

## Interactions observed

| Path | Observed result |
| --- | --- |
| Prepared contradiction → manual decision | C03 retains the original no-automatic-retry requirement; Start is disabled; comparison opens the decision. |
| Manual decision → adopted revision | Enter on Adopt returns revision 4 and an adopted outcome; work has not started. |
| Automatic alternative | Adoption stays disabled before explicit acknowledgement of changed C02/C03 and the 30-minute cap; after adoption both criteria and Start bounds reflect the change. |
| Start authority | Dialog shows exact revision, scope, commands, cap, attempts, and write mode. Confirmation is disabled until acknowledgement. Start leads to Review with one missing observation. |
| Edit/rejection recovery | Edited text survives reopening; original request is retained; dirty/rejected proposal blocks Start. New-draft recovery opens an editor. |
| Missing proof | C03 appears first, marked Unknown; Approve result stays disabled. Evidence drilldown shows missing observation and unavailable proof identity. |
| Fixture replay | Submission announces replay and disables duplicate replay; current proof enables acceptance. Producer, revision, attempt, and head remain inspectable. |
| Stale proof | All affected rows are Stale and approval is disabled. Replay refreshes current bindings. |
| Budget cap | Replay/approval are disabled. A 10-minute extension requires acknowledgement, increments revision, retains scope/attempt bounds, and makes prior proof stale. |
| Offline with current proof | Approval is disabled even when all criteria are verified. Reconnect restores the action without creating a duplicate operation. |
| Acceptance/follow-up | Explicit acceptance records the fixture result and freezes its revision. A follow-up draft is retained separately and leaves acceptance unchanged. |
| Keyboard/focus | Enter activates primary actions; native radio ArrowDown changes the option; tab ArrowRight/Home selects result views; native dialogs keep Tab focus inside; Escape closes them and restores the trigger or the current task heading. |
| Drilldowns | Changes, Checks, Evidence, Activity, project bounds, request sources, and criterion proof all open and display the corresponding fixture content. |
| Direct links | Fragment navigation to Prepared/Decision loads the corresponding fixture in an already open tab; Review also has an independent initial fixture. |

## Comparison history and fixes

| Finding | Correction and post-fix evidence |
| --- | --- |
| P2: C03 Unknown was below two successful rows at 1440 × 900 | Prioritized unresolved criteria while retaining IDs. The [final Review frame](screenshots/03-review-1440.jpg) shows the blocking negative requirement first. |
| P2: compact rail labels and prototype marker could disappear below 1200px | Added explicit navigation accessible names and restricted the hide rule to secondary copy. [Mobile Prepared](screenshots/prepared-390.jpg) and tablet frames retain the fixture marker and named navigation controls. |
| P2: hot edits of the entry file emitted duplicate React root warnings | Split the bootstrap entry from the refreshable App. Fresh reload and subsequent UI module refresh/interaction checks returned no new warning/error logs. |
| P2: short-viewport focus outline touched the top edge | Removed duplicated scroll margins while retaining action-bar clearance. [Reflow frame](screenshots/review-reflow-640.jpg) and DOM bounds show the focused control fully inside the viewport and above sticky actions. |
| P2: long decision status was harder to scan in the 1280px frame | Shortened it to “Decision required”; [final decision](screenshots/02-decision-1440.jpg) retains the complete status. |
| P2: an absent proof could imply a producer had already produced it | Labelled it Required producer and explicitly stated that the observation is not attached; see the [missing-proof dialog](screenshots/proof-missing-390.jpg). |

No actionable P0/P1/P2 findings remain within the inspected prototype scope.

## Validation and remaining gaps

- The isolated Vite build passed with output in the OS temporary directory.
- The repository gate passed lint, typecheck, all registered unit-test groups,
  build, and quality checks. It stopped at the existing dependency audit: two
  high and two moderate findings in development dependencies. Production-only
  audit reported zero vulnerabilities. The prototype adds no dependencies.
  Release verification after the failed audit was not reached by this gate.
- Final browser reload and interactions produced no new console warnings or
  errors. The earlier hot-refresh warnings are retained in the history above.
- This is direct rendered/interaction inspection through the in-app browser.
  The packaged web Playwright suite was not rerun because no production web
  source or bundle changed; it does not exercise this isolated prototype.
- Actual 200% browser zoom remains unverified: the in-app browser exposes
  viewport controls, and the tested zoom shortcut did not change page metrics.
  The 640 × 360 reflow proxy does not replace that check.
- Reduced-motion token declarations were inspected; no new animation was
  added. OS preference switching and screen-reader speech were not exercised.
- Real participant observations, full active-revision/follow-up behavior,
  multirepo and other task types, complete state inventory, durable API action
  readback, and installed acceptance remain S17/S10–S16 work.

## Implementation checklist

1. Review the three fixture screens and compare consequence/proof comprehension
   with actual participants under S01/S17 before accepting the design.
2. Complete the remaining inventory, actual zoom and assistive-technology checks.
3. Bind accepted fields/actions to S02 authority and the S10 public surface.
4. Implement the accepted composition in S11 with runtime/API/browser evidence;
   preserve the distinct S15/S16 acceptance requirements.

Follow-up polish: validate secondary label density with frequent operators and
occasional reviewers; no additional visual library or dependency is proposed.
