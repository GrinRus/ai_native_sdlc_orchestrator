# Iterative Task screen prototype

This is a local, interactive design artifact for the
[W72 Task UX](../../10-iterative-task-ux.md), owned by W72-S17. It uses synthetic
Project Atlas data and the existing Command Desk tokens, buttons, icons, and
keyboard tab primitive. It does not call the AOR API or any runner, write a
repository, persist runtime state, spend a budget, or certify a product outcome.

## Task contract

- **Outcome:** Review Prepared Task, consequential decision, and criterion-first
  Review screens by following a realistic timeout-recovery scenario.
- **Scope:** This prototype and its product-document links; production web and
  runtime sources remain the visual/component reference.
- **Constraints:** English product copy, detachable UI, explicit revision and
  Start bounds, visible negative requirements, fixture-only actions, no new
  dependencies or external services.
- **Acceptance:** Detect the proposed automatic retry that contradicts the
  original request; compare and explicitly adopt a decision; inspect each
  criterion's expected/observed behavior and current proof; prevent completion
  for unknown or stale proof; recover without enlarging authority silently.
- **Verification:** Local build, rendered desktop/narrow checks, keyboard/focus
  checks, core and recovery interactions, console inspection, reference checks,
  and the applicable repository gate. See [design QA](design-qa.md).

## Run locally

From the repository root, with the repository's supported Node version:

```bash
pnpm exec vite --config docs/product/prototypes/iterative-task/vite.config.mjs
```

Open `http://127.0.0.1:4177/`. Preview links are `/#prepared`, `/#decision`,
and `/#review`. The three preview buttons deliberately load independent fixture
snapshots. In-screen actions retain state for the connected journey. Reset demo
returns to the seeded contradiction. State is held in memory and resets on reload.

An isolated build, with output outside the repository:

```bash
pnpm exec vite build --config docs/product/prototypes/iterative-task/vite.config.mjs
```

The build is written to the operating system's temporary directory. It is not
the packaged `apps/web/dist` bundle and is not part of the npm release.

## Walkthrough

1. **Prepared Task:** Compare the original request with the generated proposal.
   C03 forbids automatic retries. Start stays disabled until the contradiction
   is resolved. Editing the proposed outcome retains the request and blocks
   Start until reconciliation.
2. **Decision:** Select manual recovery or explicitly change the request to one
   automatic retry. Inspect changed criteria, budget, and revision. Changing the
   negative requirement requires an acknowledgement. Adoption returns the
   revised contract; it never starts work. Rejecting the proposal leaves work
   blocked and offers a new draft.
3. **Start:** Authorize the displayed revision and local bounds in a dialog.
   The fixture then presents a Review with one missing behavioral observation.
4. **Review:** Read Expected / Observed / Proof for every criterion. Open proof,
   changes, checks, and activity. Replay the missing fixture check, then inspect
   and approve the local result. Approval records a simulated acceptance only.
5. **Recovery:** The fixture-state selector exposes stale evidence, exhausted
   budget, and offline presentation. Recovery refreshes proof, restores the
   connection, or opens an explicit budget decision. Completion stays blocked
   until both authority and current criterion evidence are available.

## Implementation handoff

| Surface | Public data/action requirement | Owner |
| --- | --- | --- |
| Prepared behavior and sources | Original request, effective revision, mandatory/negative criteria, provenance, material unknowns | S02/S03, projected in S10 |
| Start review | Exact revision, approval digest, allowed commands, scope, budget, write mode, route | S04/S08/S10 |
| Decision adoption | Before/after criteria, consequences, guarded revision adoption and authoritative readback | S03/S04/S12/S10 |
| Criterion Review | Expected/observed behavior, producer, attempt/revision/head identity, proof freshness | S05/S06/S10 |
| Recovery | Typed stale/offline/budget blockers and bounded recovery actions | S08/S09/S12/S10 |
| Screen composition | Existing tokens/primitives, responsive single/two-column layouts, accessible status and focus | S11 |

This is partial preparatory evidence for S17. It does not complete S01 or S17,
arrange participants, establish comprehension improvement, promote story
coverage, or replace the separate S15/S16 acceptance. Active revision, follow-up,
multirepo, and the remaining state inventory still need full S17 design work.
