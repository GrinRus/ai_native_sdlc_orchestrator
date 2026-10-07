# ADR 0027: Separate approval for exact result delivery

- Status: accepted design; W72 implementation pending.
- Date: 2026-10-06.
- Owners: W72-S06, S10, S11, S13, S16.
- Workshop decision: D18.

## Context and decision

Start authorizes bounded work before its exact output is known. Preserve the
verified patch/report as a Task result. Delivery to a target branch or PR uses
a separate approval for that concrete result.

Bind approval and delivery plan to requirement revision, current criterion
proof, exact diff digest, baseline commit, target destination, and permitted
mode. Recheck all identities before delivery effects. Changed inputs require
updated evidence/consequences and renewed applicable approval.

Patch-only Tasks can close with their verified artifact and policy-required
acceptance. Tasks requesting branch/PR delivery additionally require observed
delivery success. Independent repositories retain their own transaction stages;
partial delivery requires scoped recovery and cannot be aggregate completion.
External writes remain explicitly authorized.

## Alternatives and consequences

Preauthorizing automatic delivery at Start reduces operator stops but approves
effects before the diff exists. W72 selects explicit result approval. Existing
delivery-plan/manifest and isolated-workspace mechanisms can be adapted rather
than replaced; approval must remain a headless core command.

## Acceptance

Changed diff/base/destination or stale proof blocks delivery under old approval.
No-write/patch-only evidence cannot imply branch or network permission. A partial
multirepo transaction exposes exact recovery state. See the
[canonical model](../17-iterative-task-architecture.md).
