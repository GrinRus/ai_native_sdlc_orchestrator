# Self-hosted production readiness

## Status

AOR is a **self-hosted CLI/API production candidate** for the bounded mode documented in `docs/ops/self-hosted-release.md`. The current repository remains docs-first, but W22-W26 source-of-truth repair, hardening, real proof, production gate, stabilization, and release documentation are now closed for that self-hosted candidate mode. W30 adds alpha-hardening evidence around ADRs, OpenAPI route drift checks, self-hosted operations runbooks, readiness checks, and installed-user release smoke coverage. W31 adds a packaged local UI launch path for installed users while preserving the headless boundary. W32 adds runtime-owned operator requests for bounded analysis and proposal/patch evidence from CLI, API, and web surfaces. W33 aligns local-alpha console proof around `aor app` and removes the obsolete static snapshot surface without expanding hosted, security, or production-hardening claims.

Hosted SaaS, enterprise identity, tenant billing, hosted rollback, and managed multi-tenant operations are not in scope for the W22-W26 release.

## Baseline vs production

Baseline readiness means:
- root checks (`pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check`) pass for repository integrity;
- docs, contracts, examples, backlog, and implemented baseline surfaces stay aligned;
- supported stories may be `baseline-covered` without implying production proof;
- live E2E fixtures may prove coverage with findings when they do not materialize real code changes.

Production readiness requires:
- production-hardened auth scopes that fail closed without explicit permissions;
- nested contract validation for production-critical packets, reports, and events;
- a run-level Runtime Harness controller with run-level pass/block/fail/repair decisions;
- strict delivery gates that require current harness pass evidence and meaningful implementation changed paths;
- real non-mock full-journey proof with code-changing evidence and no upstream writes;
- a separate production-readiness gate (`pnpm production:ready`) that cannot pass without that proof.

## Current blockers

| Blocker | Owning slice | Required evidence |
|---|---|---|
| None for the W22-W26 self-hosted CLI/API production-candidate scope. | none | Remaining non-goals are outside this release mode, not blockers. |

## Closed hardening and release prerequisites

| Closed prerequisite | Owning slice | Evidence |
|---|---|---|
| Nested packet/report/event validation is production-stricter for critical families. | `W23-S01` | Invalid nested shapes fail loader tests; canonical examples pass reference integrity. |
| `production-hardened` auth fails closed without explicit permissions. | `W23-S02` | API tests cover missing, read-only, mutate-only, read+mutate, wrong-project, and redacted denial paths. |
| CLI/API lifecycle behavior has a shared service boundary. | `W23-S03` | `scripts/lint.mjs` dependency scan rejects `apps/api -> apps/cli` and `apps/cli -> apps/api` source edges. |
| Runtime Harness has run-level controller ownership. | `W24-S01` | Run-level controller tests prove pass, block, fail, repair, and exhausted-repair flows; controller-generated reports carry `run_controller`, `run_transitions`, and `run_decision`. |
| Interactive continuation has audited answer/resume/block semantics without raw-answer streaming. | `W24-S02`, `W27-S02` | `run answer`, API, SSE, and web tests prove answer audit refs, `state_history[]`, resumable `continue_run` evidence, deterministic blocked evidence for unsupported boundaries, and no raw answer text in command/read/stream surfaces. |
| Strict delivery has a consolidated code-changing gate. | `W24-S03` | Delivery tests cover no-op, out-of-scope, missing harness, missing handoff, missing promotion, and valid patch-only pass. |
| Real external-runner full-journey proof passed with no upstream write. | `W25-S02` | Promoted run evidence records `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, all required target verdicts `pass`, and no upstream write. |
| Sanitized production proof fixture is committed and story upgrades are evidence-backed. | `W25-S03` | `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json` is the committed fixture; proof integrity rejects mock-backed production claims; only fixture-backed stories are `proof-covered`. |
| Production readiness has a separate gate. | `W26-S01` | `pnpm production:ready` rejects missing or mock-backed W25 proof and verifies story honesty, auth, nested contracts, run-level harness, source-of-truth alignment, and proof fixture integrity. |
| Production-touched hotspots were stabilized without redesign. | `W26-S02` | Production proof evidence assessment was extracted from the live E2E runner into `scripts/live-e2e/lib/production-proof.mjs`; live E2E proof runner tests and slice gates passed. |
| Self-hosted release documentation is final for the bounded mode. | `W26-S03` | `docs/ops/self-hosted-release.md` documents supported mode, release gate, rollback, auth config, no-write/write-back policy, proof evidence, and non-goals. |
| Alpha hardening has reviewable ADR, API, ops, readiness, and release evidence. | `W30-S01` through `W30-S06` | ADR index, `docs/contracts/control-plane-api.openapi.json`, self-hosted operations runbooks, W30 production-readiness checks, and installed-package smoke coverage keep the alpha boundary explicit without target-stack migration. |
| Installed-user local app launch is packaged and smoke-tested. | `W31-S01` | ADR 0004, `aor app --smoke --open false --json`, packaged `apps/web/dist`, API app-route tests, web SPA tests, and release smoke evidence keep the UI optional while making first mission intake discoverable. |
| Operator-request runtime intervention is bounded and query-safe. | `W32-S01` | ADR 0005, `operator-request` contract/example coverage, request CLI/API/runtime tests, web Ask AOR coverage, proposal/patch evidence, sanitized read payloads, and live E2E fixture docs keep operator-initiated work runtime-owned. |
| Console proof uses the real local app, not generated static HTML. | `W33-S01` | `aor app --smoke true --open false --json`, app-smoke guided proof fields, updated live E2E fixtures, and web tests keep the product console path aligned with W31 without adding security or hosted scope. |

## Story status policy

`docs/product/user-story-coverage-matrix.md` uses evidence-strength statuses:
- `baseline-covered`
- `proof-covered`
- `partial`
- `blocked`

As of W33-S01, the matrix records `baseline-covered=108`, `proof-covered=4`, `partial=0`, and `blocked=2`. W33 does not change evidence strength counts. A story can move to `proof-covered` only when executable evidence proves the story outcome at the required strength.

The current production-proof fixture is `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`. It supports only the story rows that cite the fixture with `overall_status=pass`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.

## OpenCode status

OpenCode is extended candidate coverage after W22-S03. It is not a required or certified baseline provider until a future real live certification proof promotes it. Future promotion must keep permission-policy validation strict and must not use mock-backed production proof.

## Release criteria

The final verdict is **self-hosted production candidate** for the bounded CLI/API mode because:
1. W23 contract, auth, and lifecycle boundary slices are accepted.
2. W24 run-level harness, interactive continuation, and strict delivery gates are accepted.
3. W25 real external-runner full-journey proof passes with code-changing evidence and no upstream write.
4. W26 production-readiness gate (`pnpm production:ready`) passes.
5. W26 maintainability stabilization is accepted for production-touched hotspots.
6. W26 release documentation states the supported mode, rollback procedure, auth configuration, no-write/write-back policy, proof evidence, and non-goals.
7. W30 alpha-hardening checks pass for ADRs, OpenAPI route coverage, self-hosted operations docs, and release smoke boundaries.
8. W31 installed-user local app smoke passes without making the web UI mandatory.
9. W32 operator-request checks pass without turning request text into query/live payload content or bypassing delivery-mode scope.
10. W33 console alignment checks pass with app-smoke proof from `aor app` and no generated static HTML console dependency.

This verdict does not extend to hosted SaaS, enterprise identity-provider integration, managed multi-tenant operations, default upstream write-back, or uncertified extended adapters such as OpenCode.
