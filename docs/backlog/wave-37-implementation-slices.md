# W37 - live E2E target setup closure

Replan the W35-S05 blocker into a bounded target setup and verification slice
before retrying Codex/Qwen proof.

## Wave objective

Codex/Qwen live E2E proof attempts should not hang in provider-independent
target setup before the operator sees a controller decision. The `ky` setup path
must expose bounded browser dependency handling, readable blocker evidence, and
provider-independent verification status before W35-S05 can be retried.

## Wave exit criteria

- `ky` live E2E setup no longer runs unbounded `npm exec playwright install`
  inside baseline diagnostic.
- Target setup and target verification have explicit timeout/budget/status
  evidence that can be cited in W35-S05.
- Provider-independent blockers are reported separately from Codex/Qwen provider
  quality.
- AOR runner/controller failures and target repository setup/test/build failures
  are separated with `failure_owner` and `failure_phase` evidence.
- W37 evidence is citeable by W35-S05 proof closure: Codex can close cleanly and
  Qwen non-pass can be recorded as provider/environment blocker only after this
  setup path is bounded and separately reported.

---

## W37-S01 — Live E2E target setup and verification closure
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make the `ky` target setup and baseline verification path bounded, observable, and fail-closed so W35-S05 can be retried without blocking before operator-visible decisions.
- **Primary modules:** `scripts/live-e2e/**`, `docs/ops/**`, `examples/live-e2e/**`, tests
- **Hard dependencies:** W35-S04
- **Primary user story surfaces:** OPS-06, OPS-07, OPS-11.

### Local tasks
1. Replace or bound the `ky` setup command that currently invokes `npm exec playwright install` during baseline diagnostic.
2. Add target setup status evidence with elapsed time, timeout budget, selected command, and blocker reason.
3. Separate provider-independent setup/verification blockers from provider quality in live E2E summaries and runbooks.
4. Add `failure_owner` and `failure_phase` evidence so AOR failures cannot be hidden as target repository blockers, and target repository failures cannot be reported as AOR bugs.
5. Add regression coverage that a stuck browser/setup install fails closed with readable evidence instead of preventing controller decisions indefinitely.
6. Retry Codex small only far enough to prove the target setup path reaches either a controller decision or a bounded target blocker.

### Acceptance criteria
1. `pnpm live-e2e:test` passes and covers bounded target setup failure semantics.
2. A synthetic or fixture-backed setup blocker shows readable status, elapsed/budget, and a public evidence ref.
3. The `ky` small Codex path no longer blocks indefinitely on `npm exec playwright install`.
4. Synthetic AOR/controller failures and target repository command failures are classified with different `failure_owner` values.
5. W35-S05 docs point to W37-S01 as the prerequisite before Codex/Qwen proof retry.
6. No deleted bounded/mock-backed proof profiles are restored.

### Done evidence
- updated target setup/verification handling
- updated live E2E runbook/dependency matrix
- setup blocker fixture or regression test
- owner/phase classification regression test
- Codex small setup-closure retry evidence

### Out of scope
- Claiming W35-S05 proof completion as part of W37-S01 itself; W35-S05 closure
  is recorded in the W35 slice after the separate proof retry.
- Improving Qwen model quality.
- Publishing a release.
