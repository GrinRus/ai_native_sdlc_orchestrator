# ADR 0028: Breaking replacement before release

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S02, S08, S14, S16.
- Workshop decision: D09.

## Context and decision

The maintainer's planning assumption is that there are no production users or
running Tasks to migrate. W72 replaces contracts, core, runtime assets,
CLI/API/web, examples, and tests as one coherent model before release.

Do not implement old-model readers, API aliases, dual engines, opt-in strategy
rollout, old-Task migration/resumption, or rollback between engines. Develop
in bounded verified slices against fresh isolated AOR Home. Reject unsupported
old input explicitly; preserve historical documents/evidence as history.

Version/digest identity remains necessary for changing requirements, plans,
assets, policies, proof, and attempts inside the new model. Crash recovery and
partial-delivery compensation remain part of that model. No old runtime state
is deleted implicitly by this decision.

## Alternatives and consequences

An opt-in/default cutover with pinned legacy execution would add compatibility
paths without the assumed users/runs that need them. Remove those obligations
from S02/S08 and replace S14 with retired-path removal and coherent replacement
proof. Re-estimate the wave after its expanded Task foundation is planned.

## Acceptance

Fresh-state installed journeys use one model across every surface. Retired
inputs and mixed authority fail explicitly. Tests and docs contain no old-model
support obligations. Historical qualification remains separate; changed runtime
needs fresh authorized qualification. See the
[canonical model](../17-iterative-task-architecture.md).
