# Production readiness gate

## Purpose

`pnpm production:ready` is the release-disposition gate. It is intentionally
separate from `pnpm check`: the latter remains the repository-integrity baseline.
The current expected result is an audit release hold, not a production claim.

The gate is review-oriented and fails closed. It must not create runtime state, target checkouts, upstream writes, or `.aor/` artifacts.

## Command

```bash
pnpm production:ready
```

Machine-readable output:

```bash
pnpm production:ready --json
```

CI verifies the expected hold without weakening the default exit contract:

```bash
pnpm production:ready --json --expect-audit-hold
```

This mode exits successfully only for `blocked` plus
`gate_execution_status=pass`; it still fails for `fail`, `unknown`, or an
unexpected cleared state.

To verify another sanitized proof fixture:

```bash
pnpm production:ready --proof-fixture <sanitized-proof-fixture.json>
```

## Evidence checked

The default W25 production proof evidence is the sanitized fixture configured by the gate.

The gate verifies:

- complete test execution: `scripts/test-manifest.json` maps every tracked
  `*.test.mjs` file to exactly one group or a reviewed unexpired exclusion, and
  `node_modules/.cache/aor/test-execution-manifest.json` proves the current HEAD
  and manifest digest executed every candidate once;
- audit remediation ledger validity, complete AUD-001 through AUD-055
  disposition, the post-audit `project-context-cwd-divergence` entry, and every
  open release-blocking invariant;
- W57 remediation closure integrity: the exact W57 finding set maps one-to-one
  to existing deterministic evidence, while AUD-009 and AUD-052 retain their
  explicitly shared W58 disposition;

- baseline/production boundary: `pnpm check` is still the repository-integrity gate, and `pnpm production:ready` is separate;
- W25 real proof fixture: `proof_scope=full_code_changing_runtime`, `real_code_change_proof_complete=true`, `external_runner_mode=real-external-process`, evidence refs are materialized, and no upstream write occurred;
- story honesty: all 116 stories remain machine-counted, partial PBO-10/OPS-12 rows retain their backlog gaps, proof-covered rows cite executable W25 fixture evidence, and OpenCode stories remain blocked until real OpenCode certification exists;
- source-of-truth alignment: README, self-hosted readiness docs, and this runbook agree on current non-production status and gate usage;
- W23 hardening evidence: nested contract validation and production-hardened auth scope coverage are present;
- W24 harness evidence: run-level Runtime Harness report fields, strict-delivery example evidence, and controller tests exist.
- W30 alpha hardening: ADR index and accepted alpha-boundary ADRs exist, the OpenAPI 3.1 route contract matches the implemented HTTP/SSE router, self-hosted ops runbooks exist, W30 backlog source-of-truth docs are present, unsupported Docker/GHCR/SaaS/SSO/default-write-back claims remain out of scope, and OpenCode stories remain blocked without real certification proof.
- W32 operator requests: the request surface remains baseline evidence only, keeps no-write default behavior, stores raw request text only in durable artifacts, and does not upgrade production proof status without fresh executable proof.

## Failure interpretation

Top-level meanings:

- `status=blocked`, `gate_execution_status=pass`,
  `release_disposition=audit-hold`: checks ran correctly and an audited release
  invariant is still open;
- `status=fail`, `gate_execution_status=fail`,
  `release_disposition=unknown`: the gate itself or its evidence is invalid;
- `status=pass`, `release_clearance=true`: no release-blocking invariant remains.

| Failed check | Meaning | Operator action |
|---|---|---|
| `audit-remediation-ledger` | The ledger is missing, malformed, incomplete, or contains an invalid resolved claim. | Restore the ledger and evidence; do not infer release status. |
| `w57-remediation-closure` | The W57 finding set is missing, duplicated, regressed, or points at missing evidence. | Restore the closure report and its referenced deterministic suites; keep the audit hold. |
| `complete-test-execution` | The discovered-test report is missing, stale, incomplete, duplicated, or belongs to another HEAD/policy digest. | Run `pnpm test` or `pnpm check`, then rerun readiness without changing HEAD. |
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
