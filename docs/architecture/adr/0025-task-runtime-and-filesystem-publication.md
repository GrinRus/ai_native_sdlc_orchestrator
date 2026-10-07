# ADR 0025: Task runtime and filesystem publication

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S04, S09, S13, S14, S18, S19, S20.
- Workshop decisions: D06, D11, D12, D13, D15.

## Context and decision

Keep the existing private packages and filesystem/AOR Home boundary. Separate
pure Task domain transitions, application command handlers, and infrastructure
inside core; enforce import direction. CLI/API/web consume those owners.

Stage immutable artifacts and atomically publish one revisioned authoritative
head that links adoption, requirements, plan, and invalidations. Recover derived
publication after crashes. The observation journal does not replace that head.

One detached controller owns an executing Task under an exclusive lease and
fencing token. Durable child jobs retain adapter/Harness execution. Resume
reconciles existing workers, outputs, and reservations before new spawn; closing
an operator surface does not stop work. Automatic restart requires a future
supervisor, not an assumed permanent daemon.

Execution units have bounded outputs, dependencies, scope, assigned criteria,
and checks. Parallel starts require validated independence, isolated writers,
atomic reservations, capacity, and cumulative budget. Fresh integrated output
and mandatory criterion proof remain necessary for parent completion.

## Alternatives and consequences

SQLite/event sourcing, an obligatory global daemon, and immediately splitting
new workspace packages add infrastructure before a demonstrated need. A set
of unrelated atomic file writes cannot ensure multi-artifact adoption. The
chosen approach requires explicit publication/recovery and ownership tests.

## Acceptance

Crash at every publication boundary yields one recoverable authority. Duplicate
Start and expired controller recovery do not duplicate child work. Conflicting
writers serialize; successful children with failed integration cannot close
Task. See the [canonical model](../17-iterative-task-architecture.md).
