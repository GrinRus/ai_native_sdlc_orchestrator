# ADR 0026: Declarative policy and cumulative Task budget

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S02, S08, S10, S19.
- Workshop decisions: D14, D16.

## Context and decision

Extend schema-validated declarative policy profiles with known conditions and
parameters interpreted by core. Snapshot the effective policy at Start and
record facts, reasons, and consequences. Fixed safety/acceptance invariants
remain core-owned. Policy content cannot run arbitrary scripts or grant itself
authority; changed defaults do not silently affect an executing Task.

All preparation, work, repair, and checks consume one cumulative resource
ledger. Atomically reserve bounded resources before spawn and release confirmed
unused reservations after reconciliation. Resume and requirement adoption retain
spend. Interrupted attempts with unknown consumption are not zero-cost attempts.

Each resource dimension declares whether the adapter/core can enforce it,
measure it, estimate it, or cannot observe it. A requested strict monetary cap
requires an enforceable route before execution. Estimates and after-the-fact
cost reports cannot be presented as that guarantee. Exhaustion prevents new
starts and bounds active work; expansion requires explicit human authority.

## Alternatives and consequences

Code-only policies require core edits for project differences. Monetary caps
required for every route unnecessarily exclude runners controlled through
time/attempt limits. The chosen capability-aware model requires an auditable
ledger and clear user-facing distinctions.

## Acceptance

Parallel starts cannot oversubscribe reserved capacity. Retry/revision/recovery
does not reset limits. Unsupported requested guarantees fail before spawn.
Unknown facts or LLM confidence cannot weaken rules. See the
[canonical model](../17-iterative-task-architecture.md).
