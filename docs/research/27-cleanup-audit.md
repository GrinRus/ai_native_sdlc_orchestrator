# Repository cleanup audit

This maintenance audit removes demonstrably unreachable implementation and
retired instructions without changing the supported public runtime contract.
It does not close the remaining W71 installed-journey acceptance gaps.

## Iteration 1: reachability and dependencies

Base: main `18c63473f96d0d1ce9ecc8a014bcc68c0f8116bc`.

- Removed the detached pre-Task console, its exclusive browser fixtures and
  tests, six orphan CLI/harness fixtures, five superseded console documents,
  and two obsolete private maintenance modules. Packaged-app smoke coverage
  remains in `apps/web/test/packaged-task-app.test.mjs`.
- Removed unused CLI imports, private helpers, and unreachable private contract
  validation branches. The public contract kernel remains the authority; private
  rehearsal families and compatibility exports remain available.
- Replaced references to removed historical artifacts with immutable Git blob
  references. Historical screenshots remain where current docs or historical
  evidence still use them; age alone is not a deletion criterion.
- Extended the unused-code check across production JavaScript. The integration
  retains main's checked process runner, path-containment fixes, test partitions,
  guidance checks, and audit-disposition statuses.

Local integration checks passed: lint, TypeScript (zero diagnostics), and quality
ratchets (309 production files, 300 JavaScript modules, 66 public contract
families and 75 effective private families). Full gate and browser acceptance
must pass on the PR revision before merge; these focused results alone do not
establish that result. The PR's CI run is the authoritative merge evidence.

## Iteration 2: active documentation and evidence scope

Base: main `d94c599d5499c2f9191c420cda08f406e2f2587a`, after
[iteration 1 PR #296](https://github.com/GrinRus/ai_native_sdlc_orchestrator/pull/296).
Its [CI run](https://github.com/GrinRus/ai_native_sdlc_orchestrator/actions/runs/33970459445)
passed the full `pnpm check`, validated 103/103 tracked test files, and passed
all three browser scenarios. Readiness retained the valid audit hold with
`release_clearance=false`.

The second review traced current instructions to the Task renderer, Task/Flow
projections, HTTP router, request action handler, and W62 component proof:

- Strategic/planner and finance reads remain available through CLI/API; retired
  panels no longer count as current web coverage.
- FIN-03 now distinguishes W62 execution-DAG/stale-boundary fixtures from a
  produced public workspace, integration, and delivery evidence chain.
- Ask AOR is an active-Task text composer. Its Task action creates a `no-write`
  request without running it; explicit request execution and interaction answers
  remain available through the separate public CLI/API surfaces.
- Task attention exposes quality blockers and evidence refs, not the full Flow
  quality-gate detail panel. Runtime gating remains authoritative.
- Related onboarding claims now distinguish Task summaries/actions from old
  stage workbenches, raw closure-state rendering, and policy/event counters.

Accepted W32 ADR text remains historical decision evidence. The W70 target
specification remains normative; its recovery requirements do not establish
that W71-S08 implementation is complete. No runtime behavior, public contract,
story status, release hold, or future slice is changed by this iteration.

## Remaining review work

Iteration 3 must review the integrated code, documentation, links, and gate
evidence from the updated main. Each iteration is a separate PR; findings remain
open until the corresponding changes and applicable checks are complete.
