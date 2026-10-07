# ADR 0023: Task authority, decisions, and scoped blockers

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S02, S03, S04, S10, S11, S12, S13, S18.
- Workshop decisions: D01, D02, D05, D10, D17, D19.

## Context and decision

A derived Intent/Flow Task view cannot own the new end-to-end lifecycle. Task
becomes the stable orchestration entity. Its authoritative head links the
approved intake-request revision; projections, plans, and decisions cannot
become additional editable requirements.

Preserve immutable source text. Reconcile text into typed proposals; material
changes require a preview and human authority. Selecting an option with exact
displayed consequences adopts that decision without a redundant confirmation.
Publish readback only after atomic adoption. Active changes stop affected work,
fence old ownership, invalidate dependent proof/approvals, and replan. Unaffected
reuse requires matching inputs and dependency fingerprints.

Represent lifecycle, unit execution, and scoped blockers separately. Resolving
one answer clears only its own condition. Core validates state combinations and
publishes permitted actions to every transport.

## Alternatives and consequences

Keeping Task as a projection or duplicating requirements in a new Task document
leaves competing authority. Form-only interventions add operator effort.
A single large state enum grows with simultaneous blockers and parallel work.
The selected model requires CAS/idempotency, typed reconciliation, and state
consistency checks. Core delegates implementation inside reviewed bounds;
model confidence never grants permission.

## Acceptance

Manual-only answers replace contradictory automatic-retry criteria or block
adoption. Duplicate/interrupted adoption converges on one head. Late old-worker
success cannot close current requirements. One resolved blocker does not clear
unrelated conditions. See the [canonical model](../17-iterative-task-architecture.md).
