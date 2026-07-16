# Self-hosted production readiness

## Status

The July 2026 audit invalidated the historical self-hosted candidate verdict.
W57-W59 have now completed remediation and independent requalification, yielding
bounded self-hosted release clearance. The machine-readable gate returns
`status=pass`, `gate_execution_status=pass`, and
`release_disposition=cleared` only while the full ledger, closure reports, test
manifest, package proof, and source-of-truth checks remain valid.

Hosted SaaS, enterprise identity, tenant billing, hosted rollback, and managed multi-tenant operations are not in scope for the W22-W26 release.

## Baseline vs production

Baseline readiness means:
- root checks (`pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`) pass for repository integrity;
- docs, contracts, examples, backlog, and implemented baseline surfaces stay aligned;
- supported stories may be `baseline-covered` without implying production proof;
- installed-user proof fixtures may prove coverage with findings when they do not materialize real code changes.

Production readiness requires:
- production-hardened auth scopes that fail closed without explicit permissions;
- nested contract validation for production-critical packets, reports, and events;
- a run-level Runtime Harness controller with run-level pass/block/fail/repair decisions;
- strict delivery gates that require current harness pass evidence and meaningful implementation changed paths;
- real non-mock full-journey proof with code-changing evidence and no upstream writes;
- a separate production-readiness gate (`pnpm production:ready`) that cannot pass without that proof.

## Clearance constraints

| Constraint | Evidence |
|---|---|
| W57 trust-boundary and W58 runtime-quality closure must remain reproducible. | `docs/research/08-w57-security-reliability-closure.json`, `docs/research/09-w58-runtime-quality-closure.json`, adversarial suites, and package smoke. |
| All 55 audit findings and original S1 regressions must remain closed. | `docs/research/10-w59-audit-closure.json`, `docs/research/11-w59-independent-s1-review.json`, and the remediation ledger. |
| The clearance remains bounded rather than hosted or universal. | Node 22, local filesystem runtime, loopback app or hardened headless API, no default upstream write, and explicit exclusions below. |

## Historical hardening and release evidence

| Closed prerequisite | Owning slice | Evidence |
|---|---|---|
| Nested packet/report/event validation is production-stricter for critical families. | `W23-S01` | Invalid nested shapes fail loader tests; canonical examples pass reference integrity. |
| `production-hardened` auth fails closed without explicit permissions. | `W23-S02` | API tests cover missing, read-only, mutate-only, read+mutate, wrong-project, and redacted denial paths. |
| CLI/API lifecycle behavior has a shared service boundary. | `W23-S03` | `scripts/lint.mjs` dependency scan rejects `apps/api -> apps/cli` and `apps/cli -> apps/api` source edges. |
| Runtime Harness has run-level controller ownership. | `W24-S01` | Run-level controller tests prove pass, block, fail, repair, and exhausted-repair flows; controller-generated reports carry `run_controller`, `run_transitions`, and `run_decision`. |
| Interactive continuation has audited answer/resume/block semantics without raw-answer streaming. | `W24-S02`, `W27-S02` | `run answer`, API, SSE, and web tests prove answer audit refs, `state_history[]`, resumable `continue_run` evidence, deterministic blocked evidence for unsupported boundaries, and no raw answer text in command/read/stream surfaces. |
| Strict delivery has a consolidated code-changing gate. | `W24-S03` | Delivery tests cover no-op, out-of-scope, missing harness, missing handoff, missing promotion, and valid patch-only pass. |
| Real external-runner full-journey proof passed with no upstream write. | `W25-S02` | Promoted run evidence records `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, all required target verdicts `pass`, and no upstream write. |
| Sanitized production proof fixture is committed and story upgrades are evidence-backed. | `W25-S03` | The gate-configured sanitized production proof fixture is committed; proof integrity rejects mock-backed production claims; only fixture-backed stories are `proof-covered`. |
| Production readiness has a separate gate. | `W26-S01` | `pnpm production:ready` rejects missing or mock-backed W25 proof and verifies story honesty, auth, nested contracts, run-level harness, source-of-truth alignment, and proof fixture integrity. |
| Production-touched hotspots were stabilized without redesign. | `W26-S02` | Production proof evidence assessment was extracted into the internal maintainer harness; internal rehearsal tests and slice gates passed. |
| Self-hosted release documentation is final for the bounded mode. | `W26-S03` | `docs/ops/self-hosted-release.md` documents supported mode, release gate, rollback, auth config, no-write/write-back policy, proof evidence, and non-goals. |
| Alpha hardening has reviewable ADR, API, ops, readiness, and release evidence. | `W30-S01` through `W30-S06` | ADR index, `docs/contracts/control-plane-api.openapi.json`, self-hosted operations runbooks, W30 production-readiness checks, and installed-package smoke coverage keep the alpha boundary explicit without target-stack migration. |
| Installed-user local app launch is packaged and smoke-tested. | `W31-S01` | ADR 0004, `aor app --smoke --open false --json`, packaged `apps/web/dist`, API app-route tests, web SPA tests, and release smoke evidence keep the UI optional while making first mission intake discoverable. |
| Operator-request runtime intervention is bounded and query-safe. | `W32-S01` | ADR 0005, `operator-request` contract/example coverage, request CLI/API/runtime tests, web Ask AOR coverage, proposal/patch evidence, sanitized read payloads, and installed-user fixture docs keep operator-initiated work runtime-owned. |
| Console proof uses the real local app, not generated static HTML. | `W33-S01` | `aor app --smoke true --open false --json`, app-smoke guided proof fields, updated installed-user fixtures, and web tests keep the product console path aligned with W31 without adding security or hosted scope. |
| Flow-centric console path is aligned with release smoke and proof evidence. | `W34-S01` through `W34-S07` | Flow projection contracts, runtime/control-plane flow reads, packaged flow-first SPA tests, closure-to-follow-up controls, browser-task guided proof fields, app-smoke flow selector and `New Flow` markers, and root gates keep the installed-user UI reviewable while preserving the headless boundary. |

## Story status policy

`docs/product/user-story-coverage-matrix.md` uses evidence-strength statuses:
- `baseline-covered`
- `proof-covered`
- `partial`
- `blocked`

The W59-S07 matrix records `baseline-covered=108`, `proof-covered=4`,
`partial=2`, and `blocked=2`. FIN-03 now cites the final audit closure and
independent S1 review. PBO-10 and OPS-12 remain partial, and OpenCode
certification stories remain blocked.

The current sanitized production proof fixture is configured by `pnpm production:ready`. It supports only the story rows that cite the fixture with `overall_status=pass`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.

## OpenCode status

OpenCode is extended candidate coverage after W22-S03. It is not a required or certified baseline provider until a future real live certification proof promotes it. Future promotion must keep permission-policy validation strict and must not use mock-backed production proof.

## Requalification criteria

The historical W22-W34 evidence did not by itself restore the bounded verdict.
Requalification now consists of:

1. W57 has closed its execution, filesystem, scope, permission, delivery, and concurrent-evidence trust-boundary scope with adversarial proof.
2. W58 has proved non-materializing reads, effective context, real evaluation, executable routing, asynchronous control, durable events, canonical public surfaces, and the loopback HTTP boundary; its closure report remains a required regression input.
3. W59 replaces marker checks with browser behavior, lands maintainability
   ratchets and bounded decomposition, and independently disposes every
   `AUD-001` through `AUD-055` finding.
4. W59-S07 pins the closure range, independent S1 review, exclusions, and
   algorithmic readiness decision.
5. `pnpm production:ready --json` passes the current discovered test set,
   package/install smoke, no-upstream-write checks, and closure ledger.

Requalification still does not extend to hosted SaaS, enterprise identity-provider integration, managed multi-tenant operations, default upstream write-back, or uncertified extended adapters such as OpenCode.
