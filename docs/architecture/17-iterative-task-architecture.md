# Accepted iterative Task architecture

Status: accepted design, 2026-10-06; implementation belongs to
[W72](../backlog/wave-72-implementation-slices.md). This document records the
architecture workshop, not implemented runtime or release evidence.

## Outcome and replacement boundary

AOR turns requests into verified outcomes through bounded execution and
explicit decisions about material consequences. The planning assumption is
that there are no production users or running Tasks to migrate. Replace the
old model as one coherent product before release. Develop in small verified
slices against isolated fresh AOR Home state; ship one runtime model.

Old-model compatibility readers, API aliases, selectable engines, migration of
old Tasks, and rollback between engines are outside W72. Preserve historical
research and qualification evidence as history. Requirement revisions,
recovery, and delivery compensation inside the new model remain required.
A backlog slice marked active does not establish that an OS worker is running.
W66 release qualification retains its separate ownership and evidence limits.

## Decision register

Every workshop question has one accepted answer and at least one implementing
slice. A/B records the selected workshop option; decision 09 records the
clarified full-replacement boundary. Slices remain pending until their own
acceptance evidence exists.

| ID | Architectural question | Accepted answer | ADR | W72 owners |
| --- | --- | --- | --- | --- |
| D01 | Where do effective requirements live? | A: the approved versioned intake-request body; projections and plans reference its digest. | 0023 | S02, S03, S18 |
| D02 | Which decisions may be delegated? | A: implementation within reviewed bounds; material behavior, scope, permissions, commands, or budget changes require human authority. | 0023 | S01, S04, S08 |
| D03 | What proves acceptance? | A: current pass/fail/unknown observations and evidence per mandatory criterion; freshness is separate. | 0024 | S02, S05, S06 |
| D04 | How is preparation depth chosen? | A: deterministic consequence/uncertainty policy selects preparation, execution, verification, and bounded repair. | 0024 | S07, S08, S09 |
| D05 | How do active requirements change? | A: impact preview, safe stop, atomic adoption, fencing, invalidation, and approved replan; justified unaffected work can be retained. | 0023 | S04, S12, S13 |
| D06 | What stores runtime authority? | A: filesystem/AOR Home with atomic authoritative-head publication and recovery across linked artifacts. | 0025 | S18, S04, S14 |
| D07 | What context does a runner receive? | A: mandatory compact core plus exact pinned references and bounded detail retrieval. | 0024 | S07 |
| D08 | Who defines and checks acceptance? | A: expectations and methods precede implementation; independent checks/review ground them in original sources. | 0024 | S01, S05, S15, S21 |
| D09 | How does the product migrate? | B, clarified: complete breaking replacement before release; no backward compatibility or old running-Task migration. | 0028 | S02, S08, S14, S16 |
| D10 | What is the main orchestration entity? | A: Task owns lifecycle, decisions, budget, units, and outcome; Flow cannot own a competing lifecycle. | 0023 | S02, S18, S10 |
| D11 | How is work decomposed? | A: bounded verifiable execution units with dependencies; criteria and units can have many-to-many mappings. | 0025 | S02, S09, S20 |
| D12 | When can units run in parallel? | A: validated independence, isolated writable workspaces, atomic reservations, resource limits, and final integration. | 0025 | S20, S13 |
| D13 | What supervises execution? | A: a detached controller per executing Task and durable child workers; explicit Resume reconciles interrupted execution. | 0025 | S19, S09 |
| D14 | How are policies represented? | A: schema-validated declarative profiles interpreted by core; fixed invariants cannot be waived by profiles or LLMs. | 0026 | S02, S08, S19 |
| D15 | How is code separated? | A: domain, application, and infrastructure modules inside existing core, with enforced import boundaries. | 0025 | S18, S19, S14 |
| D16 | What budget guarantees are available? | A: cumulative Task resource ledger with explicit enforced/measured/estimated/unavailable capabilities per dimension. | 0026 | S02, S19, S10 |
| D17 | How do text interventions take effect? | A: preserve source text, propose a typed action, check authority, preview material consequences, and publish adoption readback. | 0023 | S03, S04, S10, S11 |
| D18 | When is delivery authorized? | A: separate permission for the exact verified result, baseline, and destination. | 0027 | S06, S10, S11, S16 |
| D19 | How are simultaneous states represented? | A: lifecycle, unit execution, and scoped typed blockers are separate; core validates combinations and publishes actions. | 0023 | S02, S18, S10, S11 |

ADR files are registered in the [ADR index](adr/0000-index.md). The owning wave
contains concrete local tasks, dependencies, acceptance criteria, and expected
evidence for every owner in this table.

## Authority and domain model

Task has a stable identity from submission to immutable completion. It owns
the authoritative head containing lifecycle, current effective requirement
reference/digest, adopted decisions, execution plan, policy/budget snapshot,
and scoped blockers. Original submissions and later source messages remain
immutable evidence. The intake-request body remains the single editable
requirement authority through approved new revisions; the Task head links it.

A plan describes intended work. An execution unit is a bounded verifiable
output with dependencies, repository/path/resource scope, assigned criteria,
required checks, and stop conditions. An attempt is one actual execution.
Failed and superseded attempts retain observations and spent resources.
Backlog slices are contributor planning identities, never runtime Task IDs.

Lifecycle records the Task's durable progression and terminal outcome. Unit
jobs describe actual execution. Each blocker records a reason, affected
operations/units/criteria, source evidence, and a permitted resolution. Missing
criterion proof can block acceptance without blocking useful implementation;
an unanswered dependency can block one unit without stopping independent work.
Core rejects contradictory combinations and terminal closure with unresolved
mandatory conditions. A single user-facing summary is derived from these facts.

## State and execution boundaries

Domain functions decide transitions from validated facts without filesystem,
transport, or provider imports. Application handlers coordinate commands,
transactions, and allowed effects. Infrastructure implements AOR Home storage,
leases/fencing, subprocesses, workspaces, evidence, and existing package ports.
CLI/API are thin command transports; web renders server-owned projections.
Modular-monolith packaging does not collapse detached workers into one process.

Adoption stages immutable artifacts and publishes one CAS-protected
authoritative head that references the new requirements, decision, plan, and
invalidations. The filesystem protocol must recover interrupted publication
and derived projections. Multiple independent atomic file replacements alone
are not sufficient. The event journal supports observation/audit; it is not a
second lifecycle store or a requirement for full event sourcing.

Start persists the reviewed envelope and execution ownership before spawn.
An exclusive controller lease schedules units, reserves resources, reconciles
results, and applies policies. Child workers retain their existing bounded
adapter/Harness responsibilities. Closing CLI/browser does not stop the Task.
Pause/Cancel/Answer/Resume are durable commands. Explicit Resume fences expired
owners and reconciles existing jobs, results, partial outputs, and reservations
before spawning new work. Automatic restart requires a future supervisor;
no mandatory permanent daemon is introduced by W72.

Parallel work requires approved dependencies, demonstrated independence,
disjoint write/resource scopes, isolated writable checkouts, and capacity plus
budget reservations. All child success still requires fresh parent integration
against exact outputs and full mandatory criterion proof.

## Policies, context, and acceptance

Resolve schema-validated known conditions/parameters from project defaults and
the reviewed Task envelope, then snapshot the effective rules at Start. Core
safety invariants always apply. Unknown facts are explicit; model confidence
is not authority. Each choice records reason codes and inspectable consequences.
Configuration changes do not silently change an executing Task's rules.

The mandatory compiled context carries current requirements, assigned criteria,
global prohibitions, adopted decisions, unresolved facts, bounds, stop
conditions, original-source links, and relevant observations. Additional detail
is retrieved through exact immutable refs/digests. Compiler evidence records
ordering, omissions, and retrieval bounds. Mandatory constraints are preserved;
if they do not fit, reduce the unit, replan, or block.

Acceptance methods and expected observations are grounded in source material
before execution. Each mandatory criterion records expected/method/observed,
input identity, proof refs, pass/fail/unknown, and freshness. Runner assertions,
green unrelated commands, and agreeing LLM reviewers are insufficient. Manual
evidence is permitted only by explicit policy/authority. Independent review
depth follows consequences; weakening acceptance requires a material decision.

## Budget and delivery

All preparation, implementation, repair, and checking consume one cumulative
Task budget. Reserve resources before parallel starts; release only confirmed
unused reservation. Resume/revision does not reset spend. Unknown consumption
after interruption stays unresolved until reconciled. Each resource dimension
declares enforcement capability. Money estimates are not strict monetary caps;
an explicitly required strict cap blocks routes unable to ensure it.

Accounting begins with Task creation. Read-only Prepare has its own explicit
bounded authorization; Start shows resources already consumed/reserved and
reviews the remaining envelope. Preparation expenditure is never reset at Start.

Verified result, acceptance, and delivery are distinct facts. Preserve the
patch/report in AOR Home. Delivery approval pins requirement revision, proof,
diff digest, baseline commit, destination, and permitted mode. Recheck those
identities before effects. Patch-only closure requires its artifact and policy
acceptance; branch/PR delivery additionally requires observed transaction
success. Partial multirepo delivery requires scoped recovery. External writes
remain explicitly authorized.

## Verification plan and boundaries

S01 predeclares counterexamples and human-comprehension methods. S17 requires
real formative observations; S15 requires the separate comparative pilot.
Deterministic fixtures, browser tests, and provider runs retain distinct labels.

[SWE-bench selection research](../research/28-swe-bench-validation-plan.md) adds
real repository bugfixes and independent executable checking through S21.
It complements AOR-specific cases for contradictory answers, lost prohibitions,
stale proof/workers, limits, scoped blockers, and delivery. It does not prove
human comprehension or replace provider qualification. No benchmark runs or
results are asserted by this architecture record.
