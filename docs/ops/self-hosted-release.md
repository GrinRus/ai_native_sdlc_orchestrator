# Self-hosted release runbook

## Supported mode

AOR is a **self-hosted CLI/API production candidate** for the bounded mode described here:

- CLI and API/control-plane runtime are the supported operator surfaces.
- The web console is optional and detachable; CLI/API/runtime must remain usable without it.
- Runtime outputs stay under `.aor/` in the operator workspace and must not be committed.
- Production proof is limited to the committed W25 real-run fixture and the stricter production-readiness gate.

This mode does not include hosted SaaS, managed multi-tenant operations, tenant billing, enterprise identity-provider integration, or default upstream write-back automation.

## Release gate

Run the baseline repository gate first:

```bash
pnpm check
```

Then run the production-readiness gate:

```bash
pnpm production:ready
```

The production gate verifies the W25 proof fixture, story-status honesty, source-of-truth alignment, production auth hardening, nested contract validation, and run-level Runtime Harness evidence. Use JSON output for review packets:

```bash
pnpm production:ready -- --json
```

The default production proof fixture is:

- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`

## Operator setup

1. Install dependencies with `pnpm install`.
2. Keep `pnpm check` green before release review.
3. Configure the detached API in `production-hardened` mode when exposing it beyond local trusted loopback.
4. Configure bearer principals outside committed project files.
5. Grant only explicit `read` and/or `mutate` permissions needed by the caller.
6. Scope bearer principals to the expected project id unless cross-project automation is intentional.
7. Configure additional redaction values for local secrets before starting connected surfaces.

The production-hardened auth model is documented in `docs/ops/control-plane-production-hardening.md`.

## Delivery policy

Default production-candidate operation is no-upstream-write:

- Use `no-write` for inspection and rehearsal.
- Use `patch-only` for code-changing delivery proof and reviewable local patch artifacts.
- Use `local-branch` only for isolated local branch materialization.
- Use `fork-first-pr` only when the operator explicitly enables the networked flow and credentials are present.

Strict code-changing delivery must have latest run-level Runtime Harness pass evidence, review pass evidence, approved handoff/promotion evidence where required, and meaningful mission-scoped changed paths.

The W25 proof fixture demonstrates `patch-only` delivery with no upstream write.

## Rollback

Rollback is workspace-local for this supported mode:

1. Stop the detached API/web surfaces.
2. Preserve `.aor/` evidence for audit before cleanup.
3. Revert or discard local target checkout changes according to the operator's repository policy.
4. Drop local branches created by `local-branch` delivery only after delivery manifests and audit refs are preserved.
5. Re-run `pnpm check` and `pnpm production:ready` after restoring the workspace.

No hosted rollback, tenant migration rollback, or enterprise identity rollback procedure is part of this release mode.

## Proof Evidence

Production-candidate proof is reviewable through:

- `examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json`
- `docs/ops/production-readiness-gate.md`
- `docs/backlog/self-hosted-production-readiness.md`
- `docs/product/user-story-coverage-matrix.md`

The proof must remain non-mock, code-changing, `external_runner_mode=real-external-process`, `real_code_change_proof_complete=true`, `overall_verdict=pass`, and no-upstream-write.

## Non-goals

- Hosted SaaS operation.
- Enterprise identity-provider integration.
- Managed multi-tenant operations.
- Tenant billing.
- Default upstream write-back.
- Broad production certification for every candidate provider.
- OpenCode live-baseline certification without future real OpenCode runner evidence.
