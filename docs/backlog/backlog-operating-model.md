# Backlog operating model

## Purpose

This document defines how AOR implementation work should be represented in the shared backlog so that humans and agents can pick up work without guessing.

## Planning hierarchy

- **Wave** — a major delivery phase with entry conditions and exit criteria.
- **Epic** — a thematic product or platform outcome that can span multiple waves.
- **Slice** — the smallest persistent shared backlog unit. A slice should deliver one bounded outcome that can be implemented and verified end to end.
- **Local task** — a short execution checklist derived from one slice. Local tasks can change during implementation without becoming new shared backlog items unless they introduce a new independently acceptable outcome.

Runtime planning uses separate identities:

- **Plan task** — a stable, versioned unit of intended work in a wave ticket or
  handoff packet. It owns scope, criteria, verification, and expected evidence.
- **Execution unit** — an approved grouping of one or more plan tasks for
  scheduling. Grouping does not merge or replace task identity.
- **Attempt** — one concrete execution of an execution unit. Retries create new
  attempts while retaining the same task and execution-unit references.

Backlog slices and local tasks are repository planning records; they are not
runtime plan tasks and must not be reused as run or attempt identifiers.

## Source of truth rule

The shared backlog tracks **waves, epics, and slices**.

The owning wave document contains the **starter local-task outline** for each slice.

Branch-local planning notes can refine those local tasks, but the shared backlog should stay biased toward slice-sized outcomes rather than tiny task fragments.

## What makes a good slice

A good slice:

- has one primary outcome;
- names the owning wave and epic;
- targets a small set of modules;
- has explicit hard dependencies;
- has acceptance criteria that can be checked without interpretation;
- leaves durable evidence when complete;
- can be explained and reviewed without opening six unrelated documents.

A slice is too large when:

- it changes unrelated user outcomes;
- it spans too many modules with independent ownership;
- its acceptance criteria cannot fit on one screen;
- part of the work can be accepted independently.

## Required fields for every slice

Every slice in the shared backlog must include:

- `slice_id`
- `title`
- `wave`
- `epic`
- `state`
- `outcome`
- `primary_modules`
- `hard_dependencies`
- `external_blocker` when a non-dependency prerequisite intentionally keeps a slice blocked
- `primary_user_story_surfaces`
- `local_tasks`
- `acceptance_criteria`
- `done_evidence`
- `out_of_scope`

## State model

Use these states in the backlog docs:

- **ready** — can be started now because hard dependencies are already satisfied or intentionally absent.
- **blocked** — waiting on one or more hard dependencies, or on an explicit `External blocker` recorded in the owning wave document.
- **active** — currently being implemented.
- **done** — accepted against the slice criteria.

## Dependency rules

- Use **hard dependencies** when the slice cannot be accepted without another slice landing first.
- Keep the shared backlog biased toward hard dependencies. Soft dependencies can live in local notes.
- If a change modifies a contract and runtime behavior, put the contract-bearing slice first.
- Keep development guidance and runtime context separate. Changes to `AGENTS.md` or `.agents/**` do not satisfy runtime-context work unless the matching AOR-owned runtime assets and contracts change too.
- If a change modifies docs, examples, and code for one outcome, keep it as one slice unless independent acceptance is possible.

## Local-task rules

A local task plan should usually break one slice into **3 to 7 tasks**.

For new medium-or-larger slice definitions, every local task must retain
`Purpose`, concrete `Changes`, and `Validation` detail. `slice:plan` emits this
content losslessly for handoff instead of reducing it to a heading.

Use local tasks for things like:

- updating contracts and examples;
- implementing module behavior;
- adding tests and validation;
- updating runbooks, README, AGENTS, or CI.

Do **not** create a new shared slice for every small coding step.

Create or split a shared slice only when the work introduces a new independently acceptable outcome that needs to survive across sessions and reviewers.

## Execution workflow

1. Read `docs/backlog/mvp-roadmap.md` to understand the current wave plan.
2. Read `docs/backlog/mvp-implementation-backlog.md` to find the next candidate slice.
3. Check `docs/backlog/slice-dependency-graph.md` before starting blocked work.
4. Open the owning wave document and start from its built-in local-task outline.
5. Use `story-traceability` when the change affects user-visible behavior.
6. Close the slice only after every acceptance criterion has reviewable evidence.

## Continuous slice-delivery loop

The default implementation loop is sequential and slice-driven:

1. Pick one slice.
2. Build a branch-local plan from `### Local tasks`.
3. Implement the slice.
4. Run self-review against acceptance criteria.
5. Run the full root check gate (`pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`).
6. Fix gaps and rerun step 4 and step 5 until clean.
7. Commit one slice atomically.
8. Mark the slice state as `done`.
9. Recompute queue and continue until all slices are `done`.

Use the helper script to keep this loop deterministic:

- `pnpm slice:status` — show current state counts and the selected next action.
- `pnpm slice:next -- --json` — print next slice selection in machine-readable form.
- `pnpm slice:plan -- W0-S04` — print local tasks, acceptance criteria, and done evidence.
- `pnpm slice:sync-ready -- --apply` — sync `blocked`/`ready` states from dependency truth while preserving slices with explicit external blockers.
- `pnpm slice:complete -- W0-S04 --apply` — mark one slice as `done` in both backlog docs.
- `pnpm slice:gate` — run the mandatory check gate before commit.

## Learning-loop intake

When live operations produce learning artifacts (`learning-loop-scorecard-*`, `incident-report-*`, `learning-loop-handoff-*`):

1. Use the handoff artifact as the planning source.
2. Link follow-up quality work to explicit suite/capture surfaces.
3. Add backlog changes only at slice granularity in the owning wave and master backlog docs.
4. Keep run id traceability in the backlog note so improvement work can be audited back to runtime evidence.

## W7 closure evidence expectations

When closing `W7-S05`, treat one integrated rehearsal as required evidence and keep these links explicit:

1. Quality governance evidence (`evaluation-report-*`, `harness-capture-*`, `harness-replay-*`, `promotion-decision-*`).
2. Incident evidence (`incident-report-*`) linked to the same run id.
3. Finance evidence from promotion or audit surfaces (`finance_signals` or `run_audit_records[].finance_evidence`).
4. Learning-loop handoff (`learning-loop-handoff-*`) that references both backlog and quality follow-up surfaces.

Use the internal maintainer installed-user rehearsal runbook with a catalog-backed full-journey profile as the canonical closure rehearsal path.

## When creating or changing slices

If you add, remove, split, or merge a slice, update all of the following together:

- `docs/backlog/mvp-implementation-backlog.md`
- the owning wave document
- `docs/backlog/orchestrator-epics.md`
- `docs/backlog/slice-dependency-graph.md`
- `.agents/skills/backlog-workflow/SKILL.md` if the operating rule changed materially

## Current planning coverage

The repo carries detailed wave documents for every currently defined
`docs/backlog/wave-*-implementation-slices.md` file. The current highest wave is
`W65`. W22-W56 remain the completed implementation and proof history. W57 is the
selected audit-remediation lane for release truth, contracts, no-write/isolation,
permissions, delivery, initialization, project-context anchoring, and concurrent
evidence integrity. W58 continues with non-materializing reads, effective
context/evaluation, executable effective-model routing, asynchronous run control,
canonical API/CLI/OpenAPI/error behavior, and the loopback-only local-app
transport boundary. W59 owns executable browser confidence, truthful local
console correctness/accessibility, quality ratchets, bounded hotspot
decomposition, and independent closure of AUD-001 through AUD-055.

After W57-W59 audit remediation closes, W60 adds structured task planning and
the plan workbench, W61 adds portable topology, machine-local binding
management, neutral Workspace launch, and approved execution-route setup, and
W62 adds repo-aware workspace sets, bounded concurrency, integration, repair,
and coordinated delivery proof. W63 then consolidates Mission intake, action
semantics, adaptive navigation, attention/evidence work, visual-system
contracts, and browser-operable safe lifecycle parity across the installed
operator console under an explicit reversible presentation selector. W65 starts
after W63-S08 and owns route/action parity, pilot activation, default-on
cutover, rollback rehearsal, legacy renderer retirement, and post-cutover
package proof. W59-S07 is the explicit entry dependency for that later
product-maturity program; W63-S01 waits for W62-S06 so its UI contract covers
the delivered planning, topology, and execution surfaces.

W64 is a parallel post-audit maintenance lane, not a successor dependency of
W63. After W59-S07 it owns idempotent alpha-publish recovery and two independently
acceptable service-boundary refactors that should not be hidden inside P0 trust
repairs or the W60-W63/W65 product and cutover slices. W65 does not depend on
W64; any shared projection change must instead be contract-first and explicitly
sequenced so W64 remains behavior-preserving.

Because W57-W59 are audit remediation, their owning wave documents also record
`remediation_priority` and `estimated_effort`. These are planning metadata for
sequencing and capacity; acceptance still depends on executable evidence, not an
estimate or severity label.

The implementation order is still constrained by hard dependencies and explicit external blockers. A later-wave slice can be described in detail and still remain blocked until earlier-wave slices close or required real-runner proof prerequisites become available.
