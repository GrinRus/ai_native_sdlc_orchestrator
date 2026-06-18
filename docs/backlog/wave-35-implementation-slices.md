# W35 - live E2E operator UX hardening

Harden the installed-user console and live E2E operator workflow after real
Codex/Qwen proof attempts showed that long-running provider steps and manual
skill-agent decisions are still too hard to operate safely.

## Wave objective

Turn the observed live E2E UX gaps into implementable runtime, UI, and proof
slices:
- long provider steps must show heartbeat, elapsed time, timeout budget,
  running status, and last evidence update instead of looking hung;
- manual operator decisions must not require hand-writing dozens of inspected
  evidence refs;
- artifact refs must render as user-facing evidence summaries, with raw refs
  available only as debug/copy details;
- execution panels must distinguish mission-relevant code changes from
  runtime-owned artifacts, runner-owned state leaks, scratch files, and
  unrelated root output;
- stop, interrupt, diagnose, and retry actions must use public control-plane
  surfaces and preserve partial evidence;
- the updated UX must be proven through current skill-agent-only live E2E paths
  without reintroducing deleted bounded or mock-backed profiles.

## Observed evidence source

The W35 backlog comes from real local live E2E operation:
- Codex small and medium full-journey runs completed successfully.
- Qwen small/medium attempts exposed long silent provider execution, auth/env
  and timeout setup gaps, `.qwen/skills` runner-owned state leakage, and a
  false-positive real-code-change pass on a root scratch file.
- A follow-up Qwen run
  `live-e2e.full-journey.regress.ky.small.qwen-missiongate-1780379640`
  reached execution with `discovery`, `spec`, `planning`, and `handoff`
  accepted, launched Qwen with `--bare --exclude-tools skill --max-wall-time`,
  showed mission-relevant target changes under `source/` and `test/`, but
  remained silent for roughly 8-9 minutes before the operator stopped waiting.

## Wave exit criteria

- Provider execution status is visible in the console and operator reports with
  provider, adapter, step, elapsed time, timeout budget, last output, last
  artifact update, and recommended safe action.
- A silent provider step is shown as `running` or `silent-running`, not as a
  hung or completed step.
- Operator decisions can be prepared from a decision request without manually
  copying `decision_rubric.required_evidence_refs`.
- Rejected operator decisions show a human-readable reason and can be corrected
  without raw JSON editing.
- Artifact refs render as concise evidence cards/chips/table rows grouped by
  stage and status; raw paths/URIs are available through copy/debug affordances.
- Execution evidence views show target diff relevance, Runtime Harness
  decision, real-code-change status, post-run verification status, provider raw
  evidence, runner-owned state leaks, scratch files, and no-upstream-write
  status.
- Stop/interruption/retry controls save partial evidence and preserve
  headless-first, no-upstream-write behavior.
- Updated Codex/Qwen live E2E proof demonstrates the UX path through current
  skill-agent-only profiles and browser-task/front-end evidence where relevant.

---

## W35-S01 — Provider heartbeat and long-running step status
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Console, CLI, API, and live E2E reports expose a public provider-step heartbeat so long external runner work is visibly running, timed, budgeted, and diagnosable.
- **Primary modules:** `docs/product/**`, `docs/contracts/**`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, `apps/web/**`, `scripts/live-e2e/**`, tests
- **Hard dependencies:** W34-S07
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Define provider-step status fields in product and contract docs: provider, adapter, route id, step id, status, elapsed time, timeout budget, remaining budget, last stdout/stderr update, last artifact update, current command label, and recommended safe action.
2. Add runtime/live E2E controller snapshots while an external provider process is running, including `starting`, `running`, `silent-running`, `artifact-updated`, `timeout-risk`, `completed`, `interrupted`, and `failed` states.
3. Expose the snapshot through public CLI/API/web read paths and existing live-event/SSE surfaces without requiring private process inspection.
4. Render heartbeat in the local SPA stage rail and active-flow cockpit: running indicator, elapsed/budget, provider label, and last update text.
5. Add operator-report output that summarizes long-running provider status in chat-friendly JSON/text without raw process commands.
6. Ensure command/env display is redacted and does not leak auth tokens, provider keys, or host-specific secret values.
7. Add focused tests with a synthetic silent provider to prove the status remains visible before stdout or final artifacts exist.

### Acceptance criteria
1. A provider step running longer than 60 seconds shows provider, adapter, step, elapsed time, timeout budget, remaining time, and last update in UI and operator report.
2. A provider with no stdout/stderr yet shows `silent-running` plus a clear "no output yet, process still running" user-facing message.
3. The same heartbeat data is available through public control-plane reads after page refresh.
4. Runtime state distinguishes "still running" from "blocked", "completed", and "timed out".
5. No provider secrets or raw environment values appear in UI, reports, logs, or fixtures.

### Done evidence
- updated product/contract docs for provider-step status
- runtime/control-plane provider status snapshots
- UI heartbeat rendering
- CLI/operator-report status output
- synthetic silent-provider tests

### Out of scope
- Improving provider model quality.
- Requiring Qwen to complete faster.
- Private process inspection as a product dependency.
- Reintroducing bounded or mock-backed live E2E profiles.

---

## W35-S02 — User-facing artifact reference renderer
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Artifact refs render as readable evidence summaries instead of long raw file paths or packet URIs, while preserving copy/debug access to the original refs.
- **Primary modules:** `docs/contracts/**`, `packages/orchestrator-core/**`, `apps/api/**`, `apps/web/**`, `examples/control-plane-api/**`, tests
- **Hard dependencies:** W35-S01
- **Primary user story surfaces:** OPS-02, OPS-03, OPS-11, DEV-06, DEV-07.

### Local tasks
1. Define an artifact display summary model with type, stage, label, status, severity, short description, timestamp, source ref, raw ref, and available actions.
2. Add summary derivation for common refs: command traces, step observations, Runtime Harness reports, routed step results, provider raw evidence, verify summaries, target diff summaries, delivery manifests, release packets, learning handoffs, file paths, packet refs, and evidence URIs.
3. Render artifact refs as chips/cards/table rows grouped by flow stage and filtered by `Failed`, `Warnings`, `Provider`, `Runtime Harness`, `Verification`, `Diff`, `Delivery`, and `Learning`.
4. Keep raw refs available through "copy raw ref" and debug detail views, not as primary visible text.
5. Handle missing, stale, or unreadable refs gracefully with a user-facing status and diagnostic action.
6. Update API examples and tests so artifact summaries are stable and contract-covered.

### Acceptance criteria
1. Long filesystem paths and packet URIs are not primary UI text for evidence lists.
2. Each artifact ref renders with a human-readable label, type, stage, status, and short purpose.
3. Raw ref copy remains available for debugging and skill-agent evidence.
4. Missing or unreadable artifacts render as explicit findings rather than empty rows.
5. Artifact summaries are grouped by selected flow/stage and do not imply cross-flow ownership.

### Done evidence
- artifact display summary contract/docs
- runtime/API artifact summary derivation
- web evidence renderer
- control-plane examples
- unit and web tests for file refs, packet refs, evidence URIs, and missing refs

### Out of scope
- Full-text search over artifact contents.
- Hosted artifact storage.
- Hiding raw refs from debug/operator workflows.

---

## W35-S03 — Operator decision helper and decision UX
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Skill-agent operator decisions can be prepared, validated, submitted, rejected, corrected, and audited without manually hand-writing large JSON artifacts or copying dozens of required evidence refs.
- **Primary modules:** `scripts/live-e2e/**`, `apps/cli/**`, `apps/web/**`, `packages/orchestrator-core/**`, `docs/ops/**`, tests
- **Hard dependencies:** W35-S02
- **Primary user story surfaces:** OPS-04, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Add a public helper command or script path that prepares a decision artifact from `agent_decision_request_ref`, selected action, semantic status, findings, and optional operator note.
2. Auto-fill `inspected_evidence_refs` from `decision_rubric.required_evidence_refs` and preserve any required frontend evidence refs.
3. Add UI decision drawer actions: `Continue`, `Diagnose`, `Block`, `Retry public step`, `Answer`, and `Frontend interact`, with disabled states when the request does not support an action.
4. Render the decision preview as a secondary/debug view and make the primary path action-based rather than raw JSON editing.
5. Validate decision artifacts before submission and show rejected-decision reasons in readable language with a one-click corrected draft when possible.
6. Preserve audit traceability: operator ref, action, semantic analysis, inspected refs, created time, request id, and final installed decision ref.
7. Add tests proving helper-generated `continue` decisions are not rejected for missing required refs.

### Acceptance criteria
1. A `continue` decision generated by the helper includes every required inspected evidence ref from the request.
2. Missing-ref rejection does not occur on the helper path for valid decision requests.
3. Rejected decisions show a readable reason and can be corrected without editing raw JSON manually.
4. UI actions map to the same public control-plane/manual live E2E continuation behavior as the CLI helper.
5. Decision artifacts remain auditable and compatible with current skill-agent-only proof requirements.

### Done evidence
- public decision helper command or script
- UI operator decision drawer
- decision validation and rejection-copy improvements
- live E2E step-controller tests
- docs/runbook updates for manual operator decisions

### Out of scope
- Letting the UI bypass skill-agent decision policy.
- Auto-approving unsafe or failed steps.
- Removing required inspected evidence refs from proof artifacts.

---

## W35-S04 — Execution evidence panel and interruption controls
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The console gives operators a single execution panel for provider status, target diff relevance, Runtime Harness decisions, verification status, safe interruption, and public retry/diagnose controls.
- **Primary modules:** `apps/web/**`, `apps/api/**`, `apps/cli/**`, `packages/orchestrator-core/**`, `scripts/live-e2e/**`, `docs/contracts/**`, tests
- **Hard dependencies:** W35-S01, W35-S02, W35-S03
- **Primary user story surfaces:** OPS-01, OPS-04, OPS-06, OPS-07, OPS-11, DEV-05, RQA-02.

### Local tasks
1. Add execution evidence grouping for mission-relevant changed paths, runtime-owned artifacts, runner-owned state paths, scratch/unrelated files, and no-upstream-write status.
2. Render Runtime Harness decision, real-code-change status, post-run verification status, provider execution status, review status, and delivery readiness in one panel.
3. Show provider raw evidence summaries without exposing raw secrets or forcing the user to open raw JSON first.
4. Add `Stop provider`, `Save partial evidence`, `Diagnose current step`, and `Retry public step` actions through public control-plane/manual live E2E surfaces.
5. Record operator-stopped/interrupted outcomes as explicit durable evidence and avoid presenting them as crashes or successful completion.
6. Disable destructive or unsafe controls when no public continuation path exists, and explain the reason.
7. Add tests for scratch-only changes, runner-owned state leaks, mission-relevant diffs, interrupted provider steps, and retry action state.

### Acceptance criteria
1. A scratch-only provider output is visible as non-mission-relevant and cannot be mistaken for a passing implementation.
2. `.qwen/`, `.codex/`, `.claude/`, or `.opencode/` state inside the target checkout is visible as a blocking runner-owned leak.
3. Mission-relevant changes under catalog-defined prefixes are highlighted separately from runtime and scratch artifacts.
4. Stopping a running provider writes an explicit interrupted/operator-stopped status and preserves partial evidence.
5. Retry and diagnose controls invoke public surfaces only and keep no-upstream-write defaults intact.

### Done evidence
- execution evidence panel
- target-diff relevance grouping
- interruption/diagnose/retry controls
- interrupted-run evidence contract or report updates
- UI, runtime, and live E2E tests

### Out of scope
- Direct private process management from browser code.
- Force-pushing, remote PR creation, or upstream writes.
- Treating provider quality failure as AOR product success.

---

## W35-S05 — Codex/Qwen live E2E UX proof and runbook closure
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Updated live E2E proof demonstrates that Codex and Qwen small/medium operator workflows expose heartbeat, decision helper, artifact summaries, execution evidence, and safe interruption/retry behavior through current proof surfaces.
- **Primary modules:** `scripts/live-e2e/**`, `docs/ops/**`, `examples/live-e2e/**`, `apps/web/**`, `apps/cli/**`, tests
- **Hard dependencies:** W35-S04
- **Primary user story surfaces:** OPS-06, OPS-07, OPS-11, PBO-09.

### Local tasks
1. Update live E2E runbooks to require provider heartbeat, readable artifact rendering, decision-helper evidence, execution evidence panel coverage, and interruption semantics.
2. Add browser-task or web-smoke proof checks that verify heartbeat and artifact summaries are visible during a synthetic silent provider step.
3. Add proof-runner tests that helper-generated decisions satisfy required inspected refs and that rejected decision correction is visible.
4. Run at least one Codex small/medium proof and one Qwen small proof, or record a provider-quality blocker with UI evidence showing the run is still understandable and fail-closed.
5. Preserve the current skill-agent-operated proof model: accepted operator decisions, non-empty inspected refs, frontend evidence refs when profile requires them, and no-upstream-write assertions.
6. Update docs/backlog/ops traceability with the final proof result, remaining blockers, and any provider-specific limitations.
7. Preserve W37 owner/phase evidence so target repository setup/test/build failures remain distinct from AOR runner/controller failures and provider quality failures.

### Acceptance criteria
1. Proof evidence shows a long-running or synthetic silent provider step with elapsed/budget/status visible in UI/operator report.
2. Proof evidence shows operator decisions generated without manual required-ref copying.
3. Proof evidence shows artifact refs rendered as user-facing summaries with raw refs available for debug/copy.
4. Proof evidence shows execution panel handling mission-relevant diff, scratch-only output, runner-owned state leak, or interrupted state as appropriate.
5. Codex proof closes cleanly; Qwen either closes cleanly or fails/blocks with a clear provider-quality or environment reason and no false product pass.
6. Any target repository blocker is reported with `failure_owner=target_repository` and must not be counted as an AOR product pass or provider failure.

### Done evidence
- updated live E2E runbooks
- refreshed proof tests/fixtures
- Codex live E2E UX proof
- Qwen live E2E UX proof or explicit provider blocker evidence
- updated backlog/source-of-truth closure notes

### Implementation note
W35-S05 has synthetic operator-UX proof coverage in
`examples/live-e2e/fixtures/w35-s05/silent-provider-ux-proof.sample.json` and
targeted regression coverage in `scripts/test/live-e2e-proof-runner.test.mjs`.
The 2026-06-02 local live attempt summary is captured in
`examples/live-e2e/fixtures/w35-s05/live-attempts-summary.sample.json`: Codex
small reached public baseline target verification but blocked on long-running
target `npm test`/AVA/WebKit before a live controller decision could be
produced; Qwen CLI availability was confirmed, but Qwen proof was not advanced
because the shared target verification blocker occurred before provider-specific
quality could be judged. This is fail-closed blocker evidence, not a Codex proof
pass. W35-S05 must remain unfinished until a Codex small/medium proof closes
cleanly or the slice is explicitly replanned around the target-verification
environment blocker.

The 2026-06-02 post-`0.1.0-alpha.5` retry
`w35-s05-codex-small-20260602214808` reached the same provider-independent
closure class: AOR installation, target checkout, browser-cache preflight,
live-adapter preflight, intake/analyze/validate, and step plans were produced,
then baseline diagnostic stayed in `npm exec playwright install` before a
manual controller decision could be produced. Qwen was not rerun because the
same `ky` target setup path would block before any Qwen-specific quality signal.
`W37-S01` replans that target setup/verification closure before W35-S05 can be
retried as proof.
W37-S01 closed the target setup/verification blocker with bounded `ky` setup and
provider-independent verification evidence. The 2026-06-03 W35 retry then
closed the slice:

- Codex small proof `w35-s05-codex-small-proof-20260603094440` completed with
  a passing summary, covered proof evidence, accepted operator decisions for all eight included steps,
  `target_setup_status.status=pass`,
  `target_verification_status_detail.status=pass`, and
  `provider_step_status.status=completed`.
- Qwen small proof `w35-s05-qwen-interrupt-proof-20260603102247` is intentionally
  not a pass. It reached provider execution after
  `target_setup_status.status=pass` and
  `target_verification_status_detail.status=pass`, then remained silent-running
  and was stopped through public run control. The final summary records
  `status=blocked`, `provider_execution_status=interrupted`,
  `provider_step_status.status=interrupted`,
  `failure_owner=provider`, `failure_phase=provider_execution`, and
  `failure_class=provider_blocked`; run-health remains blocked with non-empty
  inspected evidence refs.
- Public Stop Provider now interrupts the supervised external runner process and
  preserves interrupted state through final run-control summary/report writes,
  so a stopped provider no longer looks like a generic crash or unclassified
  blocked run.
- Manual resume summaries hydrate target pre-execution evidence from controller
  state and surface provider/target owner-phase fields at report level, so target
  repository failures, AOR failures, provider blockers, and operator actions stay
  distinguishable in UI/operator evidence.

### Out of scope
- Requiring every candidate provider to pass product-quality gates before UI/UX proof can close.
- Restoring deleted bounded/mock-backed proof profiles.
- Automatically pushing, opening PRs, or writing upstream target repositories.
