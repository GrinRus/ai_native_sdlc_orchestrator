# W39 - live E2E provider parity standardization

Standardize provider-backed live E2E behavior after W38 exposed that Qwen,
Codex, Claude, and OpenCode could follow different Runtime Harness retry/repair
semantics for equivalent proof runs.

## Wave objective

All live E2E provider variants must share the same public lifecycle, target
setup and verification classification, evidence model, Runtime Harness
retry/repair behavior, operator decision flow, and pass/blocker semantics.
Provider-specific differences belong only at the adapter boundary: command
shape, auth/env mapping, permission flags, output parsing, and coverage tier.

## Wave exit criteria

- Live E2E runbooks define provider parity as a contract.
- Provider-pinned policy materialization supplies standard retry/repair defaults
  when profiles do not declare explicit attempt maps.
- Terminal provider failures preserve routed step, adapter raw evidence,
  provider status/progress, and Runtime Harness reports without launching an
  internal repair provider step by default.
- Qwen profiles no longer carry provider-only retry/repair maps; they use the
  same live E2E defaults as Codex, Claude, and OpenCode.
- Regression tests cover default policy materialization and zero-repair terminal
  provider evidence.

---

## W39-S01 — Live E2E provider parity policy
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make live E2E provider execution semantics provider-neutral while preserving adapter-specific launch and progress behavior.
- **Primary modules:** `scripts/live-e2e/**`, `packages/orchestrator-core/**`, `docs/ops/**`, tests
- **Hard dependencies:** W38-S01
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Document the provider parity contract in live E2E runbooks.
2. Update provider-pinned policy materialization so absent attempt maps default to no internal retry/repair for provider-backed live E2E steps.
3. Remove Qwen-only retry/repair maps from Qwen profiles while keeping adapter-specific stream-json and auth behavior.
4. Preserve Runtime Harness attempt evidence when a zero-attempt policy exhausts before any retry/repair execution.
5. Add regression coverage for default parity policy generation and terminal provider failure without internal repair.
6. Run targeted tests, `pnpm live-e2e:test`, and `pnpm slice:gate`.

### Acceptance criteria
1. Codex, Claude, OpenCode, and Qwen profiles receive the same default Runtime Harness retry/repair policy for provider-backed live E2E steps.
2. Coverage tier does not change runner lifecycle semantics.
3. A terminal provider failure writes durable evidence and fails closed without starting a `repair` routed step unless a profile explicitly opts into non-default attempts.
4. Public outer repair remains available only through `implementation_loop` and the `execution#N -> review#N` lifecycle.
5. Adapter-specific progress handling, including Qwen `stream-json`, remains supported without becoming lifecycle-specific.

### Done evidence
- updated live E2E runbooks and dependency matrix
- provider-pinned policy materialization tests
- Runtime Harness zero-repair evidence test
- Qwen profile cleanup
- slice gate output

### Out of scope
- Promoting Qwen or OpenCode from extended to required coverage.
- Removing adapter-specific launch/auth/progress configuration.
- Publishing a new npm release.
