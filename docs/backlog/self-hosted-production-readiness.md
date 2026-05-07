# Self-hosted production readiness

## Status

AOR is not production-ready today. The current repository is a docs-first baseline with implemented CLI/API/web/runtime surfaces, repository-integrity checks, and installed-user rehearsal fixtures.

The current release target is a future **self-hosted CLI/API production candidate** with optional detachable web. Hosted SaaS, enterprise identity, tenant billing, and managed multi-tenant operations are not in scope for the W22-W26 plan.

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
- strict delivery gates that require current harness pass evidence and meaningful mission-scoped changed paths;
- real non-mock full-journey proof with code-changing evidence and no upstream writes;
- a separate production-readiness gate that cannot pass without that proof.

## Current blockers

| Blocker | Owning slice | Required evidence |
|---|---|---|
| Runtime Harness ownership is step-strong but not run-level production ownership. | `W24-S01` | Run-level pass, block, fail, repair, and exhausted-repair tests. |
| Interactive continuation needs audited answer/resume/block semantics. | `W24-S02` | CLI/API/web tests prove answer audit refs without raw answer streaming. |
| Strict delivery needs one consolidated code-changing gate. | `W24-S03` | Delivery tests cover no-op, out-of-scope, missing harness, missing handoff, missing promotion, and valid patch-only pass. |
| Full-journey proof is coverage evidence, not real code-changing production proof. | `W25-S01`, `W25-S02`, `W25-S03` | `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, all required target verdicts `pass`, and no upstream write. |
| Production readiness has no separate final gate yet. | `W26-S01` | Production gate rejects missing W25 proof and verifies story honesty, auth, nested contracts, run-level harness, and proof fixture integrity. |

## Closed W23 hardening prerequisites

| Closed prerequisite | Owning slice | Evidence |
|---|---|---|
| Nested packet/report/event validation is production-stricter for critical families. | `W23-S01` | Invalid nested shapes fail loader tests; canonical examples pass reference integrity. |
| `production-hardened` auth fails closed without explicit permissions. | `W23-S02` | API tests cover missing, read-only, mutate-only, read+mutate, wrong-project, and redacted denial paths. |
| CLI/API lifecycle behavior has a shared service boundary. | `W23-S03` | `scripts/lint.mjs` dependency scan rejects `apps/api -> apps/cli` and `apps/cli -> apps/api` source edges. |

## Story status policy

`docs/product/user-story-coverage-matrix.md` uses evidence-strength statuses:
- `baseline-covered`
- `proof-covered`
- `partial`
- `blocked`

As of W23-S02, the matrix records `baseline-covered=67`, `proof-covered=0`, `partial=42`, and `blocked=3`. A story can move to `proof-covered` only when executable evidence proves the story outcome at the required strength.

## OpenCode status

OpenCode is extended candidate coverage after W22-S03. It is not a required or certified baseline provider until a future real live certification proof promotes it. Future promotion must keep permission-policy validation strict and must not use mock-backed production proof.

## Release criteria

The final verdict can change from "not production-ready" to "self-hosted production candidate" only after:
1. W23 contract, auth, and lifecycle boundary slices are accepted.
2. W24 run-level harness, interactive continuation, and strict delivery gates are accepted.
3. W25 real external-runner full-journey proof passes with code-changing evidence and no upstream write.
4. W26 production-readiness gate passes.
5. W26 release documentation states the supported mode, rollback procedure, auth configuration, no-write/write-back policy, proof evidence, and non-goals.
