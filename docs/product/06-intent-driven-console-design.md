# Intent-driven console design

Status: successor product contract for the web console

AOR is intent-driven at ingress and evidence-driven after confirmation:

`Project → Intent → Prepared task → Mission → Flow → Run → Evidence`

An Intent is immutable user input. Preparation is a read-only normalization
projection. Confirmation creates the Mission and Flow, but does not start a
provider. Discovery is the first safe operator action in the Flow Cockpit.

## Surfaces

- **Project Home**: returning users see the active Flow and its single next
  action, recent Flows, search/filter, and a clear `New intent` action. The
  lifecycle rail is absent because no Flow is selected.
- **New intent**: captures request text and text attachments. It may restore a
  submitted, prepared, or blocked Intent after reload. It never creates a Flow
  while the request is being prepared.
- **Prepared task**: review-first surface for outcome, acceptance, scope,
  work type, delivery mode, confidence, assumptions, and the server-derived
  planned path. Local edits are dirty until saved; confirmation is disabled
  while dirty.
- **Flow Cockpit**: shows Project + Flow context, title, work type, current
  step, adaptive path, contract, next action, why it is next, and evidence.
  `Run discovery` is the first safe action after confirmation.

## Adaptive path

`analyze`, `explain`, and `review` use `Discover → Verify → Learn`.
`document-change` and `code-change` use
`Discover → Define → Plan → Execute → Verify → Deliver → Learn`.

The path is a runtime-owned read model. A step may be skipped only when the
runtime returns a durable reason and evidence references. The browser never
computes a safe next action or decides to skip a step.

## Navigation invariants

- Project selection never silently selects the first Flow.
- Reload preserves the selected surface through URL state:
  `?project=<id>&surface=home`, `intent`, `prepared`, or
  `flow&flow=<id>&mode=cockpit`.
- Lifecycle is rendered only when a Flow exists and is selected.
- Completed Flows remain immutable; follow-up work starts with a new Intent.

## Acceptance criteria

- Confirmation payload and the displayed prepared task are identical.
- Confirmation creates a Flow without starting a provider.
- The Cockpit starts Discovery exactly once through the server-owned safe
  action.
- Returning users can resume an unfinished Intent after a reload.
- Project Home summaries expose title, work type, current step, next action,
  attention/blocker counts, evidence count, and a stable updated timestamp.

W69 implementation binding: `W69-S01` owns confirmation CAS and contract parity;
`W69-S02` owns runtime lifecycle/read-model projection; `W69-S03` and
`W69-S04` own Home recovery and review-first Prepared Task; `W69-S05` owns
Cockpit context/path presentation; `W69-S06`/`W69-S07` own incremental web
cleanup and proof. The historical W66 provider qualification policy remains
unchanged.
