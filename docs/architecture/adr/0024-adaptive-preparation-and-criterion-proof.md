# ADR 0024: Adaptive preparation and criterion proof

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S01, S02, S05, S06, S07, S08, S09, S15, S21.
- Workshop decisions: D03, D04, D07, D08.

## Context and decision

Fixed large-spec stages and aggregate command success do not establish that
the requested behavior was understood or achieved. Core chooses preparation,
execution, verification, and bounded repair from deterministic consequence and
uncertainty rules, preserving prerequisites and durable reasons for skipped
outputs.

Acceptance expectations/methods precede implementation and remain grounded in
original sources, including negative requirements. Produce independent,
controller-owned pass/fail/unknown observations with input identity, evidence,
and separate freshness per mandatory criterion. Required missing/stale proof
blocks closure. Consequence policy chooses independent review depth; changing
acceptance materially requires authority.

Compile a mandatory compact core and exact pinned detail references. Original
sources, requirements, constraints, decisions, unknowns, bounds, and assigned
criteria remain present. Record compaction and retrieval limits. Reduce the
unit, replan, or block when mandatory content does not fit.

## Alternatives and consequences

An unconditional spec pipeline adds review burden regardless of consequences.
A successful executor report or another agreeing LLM is not independent proof.
The chosen model requires criterion-aware observations, source checks,
provenance, and invalidation rather than generic satisfied flags.

## Acceptance

Irrelevant passing tests, lost prohibitions, forged observations, and stale
inputs fail. Simple bounded tasks can skip unnecessary preparation with reasons;
missing required design facts still block. Synthetic fixtures remain separate
from actual human-comprehension observations and live-provider evidence.
See the [canonical model](../17-iterative-task-architecture.md).
