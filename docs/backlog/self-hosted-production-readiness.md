# Self-hosted production readiness

## Status

The historical **self-hosted CLI/API production candidate** verdict is under an audit release hold and is not the current AOR status. W22-W34 evidence remains useful as a historical bounded baseline, but the July 2026 audit found confirmed execution, permission, delivery, evidence, and quality-gate failures that invalidate the previous readiness verdict. W57-W59 own remediation and independent requalification. The machine-readable gate now distinguishes a healthy enforced hold (`status=blocked`, `gate_execution_status=pass`) from an invalid gate (`status=fail`, `release_disposition=unknown`).

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

## Current blockers

| Blocker | Owning slice | Required evidence |
|---|---|---|
| Release/readiness sources and gates encode the July 2026 audit hold; runtime fixes remain open. | `W57-S01` | Machine-readable ledger, threat-model boundary, story-gap disposition, blocked readiness fixture, and default unsafe-mode denial. |
| No-write, workspace, path/scope, permission, delivery, and evidence trust boundaries are not reliable. | `W57-S02` through `W57-S08` | Adversarial regression evidence and an independently reviewable W57 disposition. |
| Runtime context, evaluation, routing, control, event, API, and local HTTP behavior are not yet truthful end to end. | `W58-S01` through `W58-S08` | Cross-process and installed-package runtime-quality acceptance proof. |
| Browser behavior, maintainability ratchets, hotspot decomposition, and independent audit closure remain open. | `W59-S01` through `W59-S07` | Executable browser evidence, quality baselines, finding-by-finding closure ledger, and a new readiness decision. |

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

The W57-S01 matrix records `baseline-covered=102`, `proof-covered=3`, `partial=9`, and `blocked=2`. It reopens the seven audit-invalidated outcomes and limits PBO-09 to its demonstrated repo-attached first-Mission flow. PBO-10 and OPS-12 remain partial; W34/W56 evidence does not prove neutral launch, execution/model readiness, or a complete UI-only lifecycle. A story can move to `proof-covered` only when executable evidence proves the outcome at the required strength.

The current sanitized production proof fixture is configured by `pnpm production:ready`. It supports only the story rows that cite the fixture with `overall_status=pass`, `real_code_change_proof_complete=true`, and `external_runner_mode=real-external-process`.

## OpenCode status

OpenCode is extended candidate coverage after W22-S03. It is not a required or certified baseline provider until a future real live certification proof promotes it. Future promotion must keep permission-policy validation strict and must not use mock-backed production proof.

## Requalification criteria

The historical W22-W34 evidence does not by itself restore the production-candidate verdict. Requalification requires:

1. W57 closes every execution, filesystem, scope, permission, delivery, and concurrent-evidence trust blocker with adversarial proof.
2. W58 proves non-materializing reads, effective context, real evaluation, executable routing, asynchronous control, durable events, canonical public surfaces, and the loopback HTTP boundary.
3. W59 replaces marker checks with browser behavior, lands maintainability ratchets and bounded decomposition, and independently disposes every `AUD-001` through `AUD-055` finding.
4. `W59-S07` updates the readiness, release, story, and roadmap sources only after all remaining S1 findings are resolved or an explicit narrower release claim is approved.
5. A new production-readiness decision passes the full discovered test set, package/install smoke, no-upstream-write checks, and the audit closure ledger.

Requalification still does not extend to hosted SaaS, enterprise identity-provider integration, managed multi-tenant operations, default upstream write-back, or uncertified extended adapters such as OpenCode.
