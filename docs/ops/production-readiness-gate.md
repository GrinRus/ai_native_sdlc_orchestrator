# Production readiness gate

## Purpose

`pnpm production:ready` is the self-hosted production-readiness gate. It is intentionally separate from `pnpm check`: `pnpm check` remains the repository-integrity baseline for lint, tests, and build checks, while `pnpm production:ready` evaluates whether the current repo evidence supports the self-hosted CLI/API production-candidate claim.

The gate is review-oriented and fails closed. It must not create runtime state, target checkouts, upstream writes, or `.aor/` artifacts.

## Command

```bash
pnpm production:ready
```

Machine-readable output:

```bash
pnpm production:ready --json
```

To verify another sanitized proof fixture:

```bash
pnpm production:ready --proof-fixture examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json
```

## Evidence checked

The default W25 production proof evidence is:

- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`

The gate verifies:

- baseline/production boundary: `pnpm check` is still the repository-integrity gate, and `pnpm production:ready` is separate;
- W25 real proof fixture: `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, target verdicts pass, and no upstream write occurred;
- story honesty: all 114 stories remain machine-counted, proof-covered rows cite executable W25 fixture evidence, and OpenCode stories remain blocked until real OpenCode certification exists;
- source-of-truth alignment: README, self-hosted readiness docs, and this runbook agree on current non-production status and gate usage;
- W23 hardening evidence: nested contract validation and production-hardened auth scope coverage are present;
- W24 harness evidence: run-level Runtime Harness report fields, strict-delivery example evidence, and controller tests exist.
- W30 alpha hardening: ADR index and accepted alpha-boundary ADRs exist, the OpenAPI 3.1 route contract matches the implemented HTTP/SSE router, self-hosted ops runbooks exist, W30 backlog source-of-truth docs are present, unsupported Docker/GHCR/SaaS/SSO/default-write-back claims remain out of scope, and OpenCode stories remain blocked without real certification proof.
- W32 operator requests: the request surface remains baseline evidence only, keeps no-write default behavior, stores raw request text only in durable artifacts, and does not upgrade production proof status without fresh executable proof.

## Failure interpretation

| Failed check | Meaning | Operator action |
|---|---|---|
| `baseline-boundary` | `pnpm check` or `pnpm production:ready` no longer has the expected meaning. | Restore the script boundary before making any production claim. |
| `w25-real-proof-fixture` | The proof fixture is missing, unsafe, mock-backed, non-passing, or no longer proves code-changing no-upstream-write execution. | Re-run or re-sanitize W25 proof evidence; do not replace it with mock output. |
| `story-status-honesty` | Story statuses or counts overstate production evidence. | Update only evidence-backed rows; leave residual stories `partial` or `blocked`. |
| `source-of-truth-alignment` | README/readiness/runbook docs disagree. | Align wording before release review. |
| `production-auth-hardening` | Production auth scope or redaction evidence is incomplete. | Restore W23-S02 docs and tests. |
| `contract-and-harness-evidence` | Nested contract or run-level Runtime Harness evidence is incomplete. | Restore W23-S01/W24-S01 contract, example, and test evidence. |
| `w30-alpha-hardening` | W30 ADRs, OpenAPI route contract, ops runbooks, backlog source-of-truth, or alpha non-goal claims are missing or drifting. | Restore W30 docs/spec/check evidence before release review. |
| `operator-request-drift` | Operator-request docs, contracts, or read surfaces imply chat-style direct mutation or expose raw request text. | Restore W32 baseline semantics before using the request surface in release review. |

## Safety rules

- Do not commit `.aor/**`, target checkouts, local transcripts, tokens, or unsanitized run artifacts as production proof.
- Do not treat W14 coverage fixtures or deterministic external-runner mock output as production proof.
- Do not enable upstream write-back by default. The committed W25 proof fixture must retain the no-upstream-write assertion.
- Do not move OpenCode stories to `proof-covered` until a real OpenCode certification proof exists.
- Do not claim W30 target-architecture migration, Docker/GHCR distribution, hosted SaaS, enterprise SSO, or default upstream write-back from the alpha-hardening gate.
