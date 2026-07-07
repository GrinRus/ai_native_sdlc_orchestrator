# Backlog operating model

## Purpose

This document defines how AOR implementation work should be represented in the shared backlog so that humans and agents can pick up work without guessing.

## Planning hierarchy

- **Wave** — a major delivery phase with entry conditions and exit criteria.
- **Epic** — a thematic product or platform outcome that can span multiple waves.
- **Slice** — the smallest persistent shared backlog unit. A slice should deliver one bounded outcome that can be implemented and verified end to end.
- **Local task** — a short execution checklist derived from one slice. Local tasks can change during implementation without becoming new shared backlog items unless they introduce a new independently acceptable outcome.

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

The repo carries detailed wave documents for every currently defined `docs/backlog/wave-*-implementation-slices.md` file. The current highest wave is `W56`: W22 repairs source-of-truth and OpenCode maturity claims, W23 queues contract/auth/control-plane hardening, W24 owns run-level Runtime Harness work, W25 owns real non-mock production proof, W26 owns the self-hosted production release gate, W27 owns the black-box internal installed-user rehearsal step-journal redesign, W28 closes installed-user rehearsal gaps plus target-matrix expansion, W29 opens the guarded npm CLI alpha release channel, W30 hardens the alpha boundary with ADRs, OpenAPI drift checks, operations runbooks, readiness evidence, and release smoke coverage, W31 adds the packaged local app launch plus first Mission intake UI for installed users, W32 adds runtime-owned operator requests across CLI, API, and web, W33 aligns the console source of truth around `aor app`, removes the obsolete static snapshot surface, and tracks post-audit local-alpha stabilization fixes without adding security or hosted-production scope, W34 closes the flow-centric console refactor plus browser-task installed-user proof without reintroducing deleted bounded rehearsal profiles, W35 hardens internal installed-user rehearsal operator UX for long-running providers, decision-helper automation, readable artifact rendering, execution evidence, interruption controls, and Codex/Qwen proof, W36 adds no-settings UI onboarding plus an explicit local multi-project workspace without hosted portfolio scope, W37 replans internal installed-user rehearsal target setup closure so W35-S05 proof retries do not block on unbounded Playwright or target verification setup before operator-visible decisions, W38 makes Qwen candidate stream progress visible through public operator surfaces without depending on private Qwen logs, W39 standardizes internal installed-user rehearsal provider lifecycle semantics across Codex, Claude, OpenCode, and Qwen, W40 tracks post-alpha.7 installed-user hardening, active internal installed-user rehearsal heartbeat surfacing, release/onboarding docs polish, and optional provider qualification planning, W41 tracks post-alpha.8 installed-user validation, provider qualification evidence refresh, and findings closure before any follow-up release decision, W42 queues alpha.9 release prep plus operator-initiated internal installed-user rehearsal interruption owner/phase cleanup, W43 validates the published alpha.10 package plus internal installed-user rehearsal interruption confidence evidence before any next release decision, W44 splits discovery/research/spec prompt granularity while defining readiness and stale-transition invariants plus post-implementation docs/internal rehearsal validation, W45 adds bounded review/QA repair-loop planning with contract-first lineage, next-action state, operator visibility, proof coverage, plus mandatory post-implementation docs refresh and internal installed-user rehearsal acceptance evidence, W46 rebuilds internal installed-user rehearsal as black-box product-change assessment with small flow canaries, medium+ product missions, step-quality gates, larger budgets, catalog migration, and hard target expansion, W47 converts classified W46 blockers into strict product-acceptance closure across AOR UI accessibility, hard-target isolation, repair convergence, and proof reruns, W48 extends medium+ product-change rehearsal into a realistic implementation quality cycle with QA-origin public repair, structured repair context, hard-target toolchain policy, and successor-proof reconciliation through W49/W50, W49 closes quality-cycle proof gaps with repair anti-loop enforcement, QA-specific step quality, findings hygiene, and a mandatory Full Control proof rerun slice, W50 closes W49 Fastify/Vitest blockers with review verification mapping, target toolchain fail-fast, control proof rerun, and findings sync, W51 tracks clean-commit proof reruns, Vitest large acceptance, final-quality report hydration, explicit target-readiness semantics, and the next hard target expansion gate, W52 converts the remaining Vitest and SQLAlchemy hard-target installed-user rehearsal evidence into product acceptance or precise non-acceptance blockers, W53 generalizes target verification into AOR command groups while enforcing the AOR/live E2E boundary, W54 turns generic verification command groups into authoring, stack discovery, generated profiles, operator-visible plan surfaces, archetype smoke coverage, and expanded boundary regression guards, W55 turns the latest `ky` large/xlarge control findings into actionable repair evidence, target-catalog alignment, Claude xlarge guardrails, and control rerun reporting, and W56 hardens installed-user first-run console focus and action clarity.

The implementation order is still constrained by hard dependencies and explicit external blockers. A later-wave slice can be described in detail and still remain blocked until earlier-wave slices close or required real-runner proof prerequisites become available.
