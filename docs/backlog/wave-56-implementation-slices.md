# W56 implementation slices

W56 turns the latest local app UX gap analysis into one focused installed-user
console hardening slice. It does not change AOR contracts, CLI/API behavior,
runtime orchestration, delivery modes, or live E2E acceptance policy.

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
