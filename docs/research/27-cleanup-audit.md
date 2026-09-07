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

## Iteration 3: integrated consistency and verification

Base: main `f008fc744b3725162d57b5abd40a2b5a58b47052`, after
[iteration 2 PR #297](https://github.com/GrinRus/ai_native_sdlc_orchestrator/pull/297).
Its [CI run](https://github.com/GrinRus/ai_native_sdlc_orchestrator/actions/runs/33971181902)
passed the full gate, validated 103/103 tracked test files, and passed all three
browser scenarios with the existing readiness audit hold. Runtime, build, test,
workflow, and dependency files are byte-identical to the merged first iteration.

The third review restarted from that integrated base:

| Surface | Evidence and result |
|---|---|
| Module references | Parsed 418 JavaScript/TypeScript source and test modules; no missing literal relative imports or re-exports. |
| Public exports | Compared all 17 changed package source modules with the pre-cleanup main; declared exports are unchanged. |
| Production checks | Quality ratchet passed for 309 production files and 300 JavaScript modules; coverage accounts for 421 source files, 103 unit-test files, one browser specification, and two generated-file exclusions. |
| Contract authority | Kernel v13 parity passed with 66 public and 75 effective private families; dependency policy passed with 10 locked direct dependencies. |
| Packaged UI | Freshness check passed against current source; prior full CI exercised all three retained browser scenarios. |
| Local documentation links | Scanned 303 tracked Markdown files and classified 173 actual local links; no missing targets or anchors. One initial candidate was identifier-regex syntax inside a code block, not a link. |
| Historical evidence | All 105 pinned references resolve to 32 existing Git blob targets. No unpinned local references to deleted files remain in the scanned text surfaces. |
| External references | Rechecked 65 existing outbound URLs: 64 returned HTTP 2xx; the npm package page returned 403, while the public npm registry confirms that the package exists. The replacement Codex workflow-directory link also returned 2xx; audit PR and CI references were verified through GitHub. |
| Examples and compatibility | Reference-integrity checks passed for 260 refs and 224 compatibility checks. |
| Committed scratch state | No tracked `.aor/`, `node_modules/`, backup, reject, temporary, log, or `.DS_Store` files were found by the targeted inventory. |

No additional confirmed cleanup finding remained after this pass. This iteration
records the review instead of introducing a synthetic runtime change. The PR's
full CI result and the final merged-main check remain the authoritative gate
evidence; this report's focused checks do not substitute for them.

## Retention and decision boundaries

- Safe removals were the 63 non-build files whose current consumers were retired
  or absent, plus unused private code and regenerated bundle assets.
- Keep referenced historical screenshots, pinned closure evidence, fixtures with
  active tests, intentional privacy omissions in object destructuring, and
  public compatibility exports. Static absence of an internal caller is not
  sufficient evidence to remove a shipped entrypoint.
- Removing supported CLI/API capabilities, contract families, unique audit
  history, or unrelated workspace/user state requires a separate scoped
  decision. None is proposed as remaining confirmed garbage.
- W71 runtime acceptance work, W66 provider qualification, and the existing
  production release hold remain outside this cleanup. HTTP 403 is an access
  limitation, not evidence of a dead npm link. The review does not claim absolute
  absence of all possible unused code or semantic documentation drift.
