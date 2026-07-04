# End-to-end flow

## Canonical flow
1. `project init`
2. `project analyze`
3. `project validate`
4. `project verify`
5. feature-intent intake request
6. discovery packet
7. discovery research / ADR-readiness report
8. spec packet
9. wave ticket
10. handoff packet and approval
11. execution run
12. review and QA
13. delivery manifest
14. release packet
15. incident or close
16. learning handoff, dataset / suite backfill, and recertification when needed

## Discovery-to-planning readiness

The discovery -> research -> spec -> planning path is inspected through the
same public runtime reports that guide operators:

- `aor discovery run` materializes project analysis plus a
  `discovery-research-report` whose status determines research readiness.
- `aor next` materializes `next-action-report.artifact_readiness` after
  mission, discovery, spec, and planning checkpoints when a maintainer
  rehearsal needs acceptance evidence.
- `aor spec build` emits a routed step-result whose compiled-context artifact
  records the selected spec prompt bundle, required packet refs, context bundle
  refs, skill refs, and compiler provenance.
- `aor wave create` materializes the wave ticket and handoff packet that make
  planning readiness inspectable.

Maintainer rehearsal summaries may copy a compact proof from those public
reports, but they must not become a second owner of readiness decisions. The
next-action report remains the public read model for blocked, stale,
incomplete, ADR-ready, ready, and pending states.

## Guided installed-user overlay
The installed-user journey source of truth is `docs/product/02-installed-user-onboarding-journey.md`.

Guided commands and web stages are an overlay on the canonical flow:
- first-run and doctor guidance explain readiness before mutation;
- onboarding wraps bootstrap, analysis, validation, registry-root resolution, and onboarding reports;
- mission intake wraps product-intake packets and source refs;
- next-action resolution reads durable packets, reports, policy state, review decisions, and run-control state;
- optional web stages mirror control-plane read models and lifecycle mutations;
- review, delivery, release, and learning closure remain contract-backed artifacts.

The overlay must not change the orchestration owner. CLI, API, and web surfaces should all point back to the same runtime-owned commands, control-plane mutations, and durable evidence refs.

## Flow-centric overlay

W34 adds a flow projection over the canonical flow without changing the
canonical artifact owners. A flow groups one mission/intake lineage, the latest
next-action report, run/review/delivery/release/learning evidence, and
operator-request summaries under one stable `flow_id`.

Active flows remain mutable only through runtime-owned commands and
control-plane mutations. Completed flows are read-only evidence chains. Starting
`New Flow` creates a new mission/intake packet and refreshes `next`; if it is a
follow-up, it cites the completed source flow's learning handoff instead of
reopening or editing the completed flow.

## Why bootstrap is a first-class stage
AOR cannot safely run against a repository until it knows:
- its topology,
- its commands,
- its service boundaries,
- its risk zones,
- its missing prerequisites,
- its local verification path.

## Why delivery is not the end
The full loop closes only when:
- delivery artifacts exist,
- review verdict artifacts exist,
- sign-offs are recorded,
- incidents can feed back into quality memory,
- learning-loop handoff exists for follow-up,
- platform assets can be recertified if needed.

## Installed-user safety rule
For clean or public repositories, guided flows default to no upstream writes. Any path that can produce patches, branches, fork PRs, release packets, or network writes must first expose delivery mode, writeback policy, handoff approval, review decision, promotion evidence, route governance, and bounded command scope.
