# Self-hosted release runbook

## Supported mode

AOR has **bounded self-hosted release clearance** after the W57-W59 audit
remediation and independent requalification. This clearance is limited to the
declared Node 22 CLI/API, loopback local app, and no-upstream-write defaults.

- CLI and API/control-plane runtime are supported operator surfaces.
- The npm alpha also includes an optional packaged local web console launched by `aor app`; CLI/API/runtime must remain usable without it.
- Runtime outputs stay under `.aor/` in the operator workspace and must not be committed.
- Production proof is limited to the committed W25 real-run fixture and the stricter production-readiness gate.
- W30 alpha-hardening ADRs, OpenAPI route drift checks, and self-hosted operations runbooks are part of the reviewable bounded-mode evidence.
- W31 installed-user app launch evidence covers the local SPA first-run path without changing the headless runtime boundary.
- W32 operator-request evidence covers bounded operator-initiated analysis and proposal/patch work without changing the no-upstream-write default.

The alpha architecture boundary is recorded in
`docs/architecture/adr/0000-index.md`.

This mode does not include hosted SaaS, managed multi-tenant operations, tenant billing, enterprise identity-provider integration, or default upstream write-back automation.

## Release gate

Operators can use either the source checkout or the npm CLI alpha package
`@grinrus/aor` for the CLI entrypoint. The npm package is an alpha distribution
of the same bounded CLI/runtime surface; third-party runner binaries and
credentials remain external host prerequisites.

Run the baseline repository gate first:

```bash
pnpm check
```

This writes the ignored test-execution manifest consumed by readiness. Do not
change commits or `scripts/test-manifest.json` between the two gates.

Then run the production-readiness gate:

```bash
pnpm production:ready
```

The production gate validates its internal checks and the audit ledger. While a
release-blocking invariant is open it exits nonzero with `status=blocked` and
`gate_execution_status=pass`. An internal check failure instead returns
`status=fail` and `release_disposition=unknown`. The cleared repository returns
`status=pass` and `release_disposition=cleared`. Use JSON output for review packets:

```bash
pnpm production:ready --json
```

The default production proof fixture is the sanitized fixture configured by `pnpm production:ready`.

## Operator setup

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Keep `pnpm check` green before release review.
3. Configure the detached API in `production-hardened` mode when exposing it beyond local trusted loopback.
4. Configure bearer principals outside committed project files.
5. Grant only explicit `read` and/or `mutate` permissions needed by the caller.
6. Scope bearer principals to the expected project id unless cross-project automation is intentional.
7. Configure additional redaction values for local secrets before starting connected surfaces.
8. For installed-user UI validation, launch `aor app --project-ref <repo> --runtime-root <repo>/.aor` on loopback.
9. For operator-initiated runtime work, use `aor request create/run/status` or the local UI Ask AOR drawer; keep `delivery-mode=no-write` unless proposal patches are explicitly scoped with allowed paths.
10. Keep credentialed provider qualification and real network delivery outside
    the cleared matrix unless a separate reviewed profile explicitly authorizes
    them. The compatibility flag `--unsafe-development-override` remains
    accepted but is not required when the release disposition is cleared.

The production-hardened auth model is documented in `docs/ops/control-plane-production-hardening.md`.
Environment, secrets, backup/restore, and incident procedures are documented in:

- `docs/ops/self-hosted-environment-matrix.md`
- `docs/ops/self-hosted-secrets-and-redaction.md`
- `docs/ops/self-hosted-backup-restore.md`
- `docs/ops/self-hosted-incident-runbook.md`

## Delivery policy

Default production-candidate operation is no-upstream-write:

- Use `no-write` for inspection and rehearsal.
- Use `patch-only` for code-changing delivery proof and reviewable local patch artifacts.
- Use `local-branch` only for isolated local branch materialization.
- Use `fork-first-pr` only when the operator explicitly enables the networked flow and credentials are present.

Strict code-changing delivery must have Runtime Harness execution evidence with routed step decisions, review pass evidence, approved handoff/promotion evidence where required, and meaningful implementation changed paths. Run-level Runtime Harness evidence is preserved when available, but delivery quality is judged from execution health, review, verification, and final result evidence rather than run-level ownership alone.

The W25 proof fixture demonstrates `patch-only` delivery with no upstream write.

Operator requests follow the same delivery-policy vocabulary:

- `no-write` requests are analysis/proposal only.
- `patch-only` requests require explicit allowed paths and produce patch
  evidence rather than silent source mutation.
- `run steer` is only a run-control transition; bounded work requests go
  through `operator-request` artifacts and compiled context.
- API, CLI, web, and live/read payloads must show sanitized summaries and refs
  instead of raw request text.

## Rollback

Rollback is workspace-local for this supported mode:

1. Stop the detached API/web surfaces, including any foreground `aor app` process.
2. Preserve `.aor/` evidence for audit before cleanup.
3. Revert or discard local target checkout changes according to the operator's repository policy.
4. Drop local branches created by `local-branch` delivery only after delivery manifests and audit refs are preserved.
5. Re-run `pnpm check` and `pnpm production:ready` after restoring the workspace.

Expected rollback verification is `cleared` only when the restored checkout,
ledger, closure reports, and current test manifest still validate. Any blocked
or failed result suspends the bounded clearance until reviewed.

No hosted rollback, tenant migration rollback, or enterprise identity rollback procedure is part of this release mode.

## Proof Evidence

Production-candidate proof is reviewable through:

- the sanitized production proof fixture configured by `pnpm production:ready`
- `docs/ops/production-readiness-gate.md`
- `docs/backlog/self-hosted-production-readiness.md`
- `docs/product/user-story-coverage-matrix.md`
- `docs/architecture/adr/0000-index.md`
- `docs/contracts/control-plane-api.openapi.json`
- `docs/ops/self-hosted-environment-matrix.md`
- `docs/architecture/adr/0004-alpha-packaged-local-web-console.md`
- `docs/architecture/adr/0005-operator-requests-runtime-interventions.md`
- the sanitized operator-request proof fixture configured by the release gate

The proof must remain non-mock, code-changing, `external_runner_mode=real-external-process`, `real_code_change_proof_complete=true`, `overall_status=pass`, and no-upstream-write.

## Non-goals

- Hosted SaaS operation.
- Enterprise identity-provider integration.
- Managed multi-tenant operations.
- Tenant billing.
- Default upstream write-back.
- Broad production certification for every candidate provider.
- OpenCode live-baseline certification without future real OpenCode runner evidence.
