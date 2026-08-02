# W55 implementation slices

W55 converts the latest `ky` large/xlarge control findings into bounded
follow-up work without reopening W45 or W54. The wave keeps public AOR repair
artifacts generic while making failed verification evidence actionable enough
for the next repair execution to close specific command failures.

## W55-S01 — Backlog intake and control finding disposition

- **Outcome:** Add the W55 follow-up wave, preserve the control-run root-cause
  summary, and make the next actionable repair-evidence slice selectable.
- **Epic:** EPIC-0, EPIC-7
- **State:** done
- **Primary modules:** `docs/backlog/**`, `README.md`
- **Hard dependencies:** W54-S08

### Control finding summary
- `ky` large Codex reached review repair with a target lint failure: `npx xo`
  failed on a provider-added `string | null` type in `test/retry.ts`.
- `ky` large Claude reached review repair with target AVA failures in request
  lifecycle tests after a provider-added hook/retry implementation.
- `ky` xlarge Codex passed primary verification but review warned that changed
  `test/retry.ts` was not explicitly covered by the xlarge primary command set.
- `ky` xlarge Claude blocked in provider execution with
  `provider_context_window_exceeded`; AOR's initial work packet was compact, so
  the blocker is provider-loop context growth rather than deterministic context
  compilation overflow.

### Local tasks
1. Add W55 to roadmap, master backlog, epic map, and dependency graph.
2. Record the intended slice order: backlog intake, actionable repair evidence, `ky` xlarge profile alignment, Claude xlarge guardrails, and control reruns.
3. Confirm `pnpm slice:next -- --json` selects W55-S01 before closing this slice.
4. Complete W55-S01 only after backlog docs agree and W55-S02 becomes the next ready implementation slice.

### Acceptance criteria
1. W55 does not reopen or rewrite W45/W54 done states.
2. The four control findings are captured as follow-up planning evidence.
3. The dependency graph and master backlog agree on W55 slice ordering.
4. After W55-S01 is complete, W55-S02 is the selected ready slice.

### Done evidence
- `pnpm slice:status`
- `pnpm slice:next -- --json`
- `pnpm slice:sync-ready`
- `pnpm check`

### Out of scope
- Runtime, contract, adapter, target-catalog, or live E2E execution changes.

## W55-S02 — Actionable verification failure repair evidence

- **Outcome:** Failed verification review findings carry bounded command-level
  details into public repair decisions and provider repair packets.
- **Epic:** EPIC-4, EPIC-7
- **State:** done
- **Primary modules:** `docs/contracts/**`,
  `packages/orchestrator-core/src/review-run.mjs`, `packages/adapter-sdk/**`,
  tests
- **Hard dependencies:** W55-S01

### Local tasks
1. Document additive optional `verification_failure_details[]` on review findings and repair-context finding details.
2. Read failed `verify-summary` step-result refs in review and extract command, role, enforcement, exit/signal, timeout class, bounded stdout/stderr excerpts, failure summary, and evidence refs.
3. Preserve generic fallback wording only when command details are unavailable.
4. Ensure provider work packets carry the details through existing `repair_closure_policy.unresolved_finding_details[]`.

### Acceptance criteria
1. Old W45 repair examples remain valid unchanged.
2. Failed XO and failed AVA fixtures produce actionable command-level repair details.
3. Passing verification with only broad coverage mapping warnings still does not become `request-repair`.
4. Public artifacts do not expose private live E2E vocabulary.

### Done evidence
- contract-loader tests for additive optional fields
- review-run failed-command fixture tests
- adapter SDK repair packet propagation tests

### Out of scope
- Changing verifier command execution semantics.

## W55-S03 — `ky` xlarge primary verification alignment

- **Outcome:** The `ky-request-lifecycle-observability-xlarge` mission primary
  gate explicitly covers retry lifecycle tests while keeping full-suite
  diagnostics manual/overnight warning evidence.
- **Epic:** EPIC-7
- **State:** done
- **Primary modules:** `scripts/live-e2e/catalog/targets/ky.yaml`,
  generated profile tests, runbook docs
- **Hard dependencies:** W55-S02

### Local tasks
1. Add `npx ava test/retry.ts --match='*shouldRetry*'` to the xlarge `ky` primary command set.
2. Preserve `npx playwright install` and `npm test` as diagnostic commands with `diagnostic_failure_mode: warn`.
3. Update target-catalog/runbook wording so xlarge diagnostics are not treated as quick acceptance evidence.
4. Cover materialized xlarge profile output in live E2E catalog tests.

### Acceptance criteria
1. `ky` large and xlarge retry/hook lifecycle missions both include focused retry primary coverage.
2. Xlarge full-suite `npm test` remains manual/overnight observation evidence.
3. Catalog tests prove the generated profile contains the new primary command.

### Done evidence
- live E2E target-catalog fixture tests
- updated target catalog docs/runbook notes

### Out of scope
- Running live xlarge acceptance.

## W55-S04 — Claude xlarge context guardrails

- **Outcome:** Claude Code xlarge execution has an auth-compatible compact mode
  and clearer fail-early evidence for provider context-window overflow.
- **Epic:** EPIC-7
- **State:** done
- **Primary modules:** `examples/adapters/claude-code.yaml`,
  `packages/adapter-sdk/**`, adapter tests, provider runbooks
- **Hard dependencies:** W55-S03

### Local tasks
1. Tighten the Claude request-file instruction for bounded implementation and explicit blocked output when context grows beyond provider limits.
2. Add supported compact arguments that do not require `ANTHROPIC_API_KEY`; do not enable `--bare` by default while the local path uses `ANTHROPIC_AUTH_TOKEN`.
3. Preserve `provider_context_window_exceeded` classification with raw provider summary and context-size evidence.
4. Document when Claude xlarge should be split or retried versus counted as observation blocker.

### Acceptance criteria
1. Existing Claude adapter smoke tests still pass.
2. Context-window errors remain provider-owned blockers, not AOR compiled-context failures.
3. The adapter profile remains compatible with the current host auth path.

### Done evidence
- adapter profile tests
- context-window classification tests
- provider qualification/runbook update

### Out of scope
- Replacing Claude Code or requiring a different auth provider.

## W55-S05 — Control rerun and findings report

- **Outcome:** Re-run the control matrix after W55 fixes and publish a precise
  quality/finding report that separates regression signal, large product
  acceptance, and xlarge observation evidence.
- **Epic:** EPIC-0, EPIC-7
- **State:** done
- **Primary modules:** `docs/backlog/**`, `docs/ops/**`,
  internal live E2E run artifacts
- **Hard dependencies:** W55-S04

### Local tasks
1. Run one known-good medium repair cell to check that W45 repair behavior was not regressed.
2. Run `ky` large Codex and Claude control cells and classify product/provider outcomes from terminal evidence.
3. Run manual `ky` xlarge Codex and Claude observation cells without prematurely stopping diagnostic `npm test`.
4. Record run ids, terminal statuses, failure owner/phase/class, artifact quality notes, and follow-up decisions.

### Acceptance criteria
1. Medium known-good repair signal still passes or records a precise unrelated blocker.
2. Large `ky` cells either pass terminal product gates or expose actionable provider/target findings with command-level repair detail.
3. Xlarge outcomes are reported as manual observation evidence, not product acceptance.
4. Runtime outputs under `.aor/` remain untracked.

### Done evidence
- live E2E run ids and final summaries
- updated findings/reporting notes
- `pnpm check`

### Control rerun report

W55-S05 found two W55 repair-evidence propagation defects before the final
control matrix was trustworthy:

- `w55-s05-ky-large-codex-20260706-081928` proved that review findings carried
  actionable `verification_failure_details`, but live review repair context did
  not preserve the nested details and instead flattened command/stdout snippets
  into `evidence_refs`.
- `w55-s05-ky-large-codex-postfix-20260706-131215` proved that preserved repair
  context still did not reach the provider repair packet because
  `--promotion-evidence-refs` were absent from the routed adapter request
  context.

The W55-S05 fix keeps the public repair artifact model unchanged: failed
verification details remain nested under existing review finding/repair context
fields, and provider work packets receive them through existing
`repair_closure_policy`/repair context inputs without private live E2E
vocabulary.

| Run | Cell | Terminal status | Classification | Evidence notes |
|---|---|---|---|---|
| `w55-s05-fastify-medium-openai-20260706-074319` | known-good medium repair canary | `status=ok`, health `warn` | regression signal passed | W45 repair cycle still created and closed one quality repair request through `execution#2`; command, controller, provider, diagnostic, and evidence health passed. |
| `w55-s05-ky-large-codex-propagation-20260706-135852` | `ky` large / Codex | `status=ok`, health `pass` | product gate passed | Primary verification passed after focused target changes; no repair iteration was needed in the final run. |
| `w55-s05-ky-large-claude-20260706-141750` | `ky` large / Claude | `status=failed`, health `not_pass` | provider repair convergence failed | Claude guardrails/auth worked, provider completed, context budget passed, and the repair work packet preserved command-level AVA failure details; final primary verification still failed. |
| `w55-s05-ky-xlarge-codex-20260706-145201` | manual `ky` xlarge / Codex | `status=ok`, summary `pass` | xlarge observation passed | Primary xlarge command groups passed; diagnostic `npm test` finished and failed as warn/manual overnight evidence, not as quick acceptance or timeout. |
| `w55-s05-ky-xlarge-claude-20260706-114100` | manual `ky` xlarge / Claude | `status=not_pass`, health `blocked` | provider did not address review finding | Initial and repair provider executions completed without auth or context-window failure; the repair packet included two verification failure details, then review stopped with `provider_did_not_address_finding` before QA/delivery. |

Follow-up decision: no new W45/W54 work is needed. The remaining hard-target
non-pass cases are provider/target convergence observations with actionable
repair evidence available to the next provider attempt. Xlarge remains manual
observation evidence and is not claimed as product acceptance.

### Out of scope
- Claiming xlarge product acceptance.
