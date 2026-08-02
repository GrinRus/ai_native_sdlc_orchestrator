# W65 specialist modes pilot

W65-S04 requalifies the W63 Attention, Journey, and Evidence surfaces against the cutover parity baseline. The executable manifest is `apps/web/browser/fixtures/w65-specialist-modes-pilot.json`.

## Disposition

- Attention remains a flow-scoped projection of durable interaction, decision, verification, and repair truth. Selection and drafts are presentation state; completion requires control-plane readback.
- Journey preserves task, execution-unit, attempt, parent/child, integration, repair, and delivery identity. A failed or partial required child blocks aggregate success.
- Evidence remains a projection over the existing packet/report graph and trace. It does not create a browser-owned case file or evidence store.
- W34 human queues, workbenches, and evidence inspection outcomes have a Quiet Cockpit home. Raw identifiers and paths move to labelled disclosure rather than disappearing.

The existing installed browser scenarios cover multi-item Attention, independent drafts, flow switching, Journey blocker truth, Evidence isolation, keyboard traversal, mobile layout, reduced motion, and 200% reflow. Presentation switching does not change Project, Flow, run, action, or evidence identity.

## Safety boundary

The pilot uses deterministic loopback fixtures. It performs no external network requests, target-source writes, credentialed provider calls, or upstream writes. Missing lifecycle behavior remains owned by the relevant contract/runtime layer.
