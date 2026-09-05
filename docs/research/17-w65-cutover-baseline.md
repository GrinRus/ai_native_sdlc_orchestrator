# W65 cutover parity baseline

W65 migrates presentation only. The authoritative runtime remains the existing
project, Flow, plan, run, review, delivery, release, and learning contracts.

The machine-readable parity matrix is
[w65-cutover-parity.json snapshot (f6de7e31)](https://github.com/GrinRus/ai_native_sdlc_orchestrator/blob/f6de7e3167e74a2fd975deb5736e464cdcffac2f/apps/web/browser/fixtures/w65-cutover-parity.json). It freezes ten supported
W34 outcomes against their accepted Quiet Cockpit destination, read and
mutation routes, side effect, durable readback, and recovery path. The input
fixture set is the W34 design, the W63 operator scenario catalog, and journey
`quiet-cockpit.safe-no-write.v1`.

## Selector contract

Selection precedence is explicit query, additive app config, then compiled
default. S01 emits `console_experience=legacy`; omission remains compatible
with old app-config payloads. The selector is presentation-only and cannot
alter project selection, Flow state, authorization, lifecycle, write-back, or
evidence. Renderer/read failures remain visible and never trigger fallback.

## Coordination boundary

W64 is complete and remains behavior-preserving. W65 does not change
next-action semantics, run ordering/pagination, certification, policy, or
projection ownership. A missing canonical action, projection, recovery path,
or durable readback is an entry-condition failure and must return to its owning
contract/runtime slice rather than being implemented as browser state.

## Historical validation

The W65 validation used the
[execution-orchestration test snapshot](https://github.com/GrinRus/ai_native_sdlc_orchestrator/blob/f6de7e3167e74a2fd975deb5736e464cdcffac2f/apps/web/test/execution-orchestration.test.mjs),
HTTP transport tests, and the slice gate. The retired renderer and its tests
must be inspected at that snapshot; current gates validate the Task Workspace
and do not rerun the historical W65 presentation.
